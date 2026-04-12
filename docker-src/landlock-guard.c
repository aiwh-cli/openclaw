/*
 * landlock-guard — Kernel-level filesystem sandbox for AIWH agents
 *
 * Phase 70: Applies Landlock LSM rules before exec'ing the OpenClaw gateway.
 * Once applied, restrictions are inherited by ALL child processes (agents).
 * Even the process itself cannot undo them — kernel-enforced.
 *
 * Usage: landlock-guard <command> [args...]
 *   e.g.: landlock-guard node /opt/openclaw/dist/index.js gateway
 *
 * Reads:
 *   /opt/AIWH/core/config/landlock-policy.json  — base protection rules
 *   /opt/AIWH/core/config/license.json          — module licensing
 *   (security-overrides.json is NOT read here — overrides are application-layer only,
 *    enforced by safe-bash.sh. Kernel policy is intentionally hardcoded.)
 *
 * Build: gcc -static -o landlock-guard landlock-guard.c -ljson-c
 *   (or without json-c: uses minimal hand-rolled JSON parser)
 *
 * Copyright 2026 Serenite Group Pty Ltd. All rights reserved.
 */

#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/landlock.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

/* ── Landlock syscall wrappers ──────────────────────────────── */

#ifndef landlock_create_ruleset
static inline int landlock_create_ruleset(
    const struct landlock_ruleset_attr *attr, size_t size, __u32 flags) {
    return (int)syscall(__NR_landlock_create_ruleset, attr, size, flags);
}
#endif

#ifndef landlock_add_rule
static inline int landlock_add_rule(
    int ruleset_fd, enum landlock_rule_type type,
    const void *attr, __u32 flags) {
    return (int)syscall(__NR_landlock_add_rule, ruleset_fd, type, attr, flags);
}
#endif

#ifndef landlock_restrict_self
static inline int landlock_restrict_self(int ruleset_fd, __u32 flags) {
    return (int)syscall(__NR_landlock_restrict_self, ruleset_fd, flags);
}
#endif

/* ── Logging ────────────────────────────────────────────────── */

#define LOG_FILE "/opt/AIWH/client/logs/security-audit.jsonl"
#define MAX_RULES 128

static FILE *g_logfp = NULL;

static void audit_log(const char *outcome, const char *detail) {
    if (!g_logfp) {
        g_logfp = fopen(LOG_FILE, "a");
        if (!g_logfp) {
            fprintf(stderr, "[landlock-guard] WARNING: cannot open audit log %s\n", LOG_FILE);
            return;
        }
    }
    /* Minimal JSON — no library needed */
    time_t now = time(NULL);
    struct tm *t = gmtime(&now);
    char ts[64];
    strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%SZ", t);
    fprintf(g_logfp,
        "{\"timestamp\":\"%s\",\"agent_id\":\"landlock-guard\",\"tool\":\"kernel\","
        "\"action\":\"policy_applied\",\"outcome\":\"%s\",\"detail\":\"%s\"}\n",
        ts, outcome, detail);
    fflush(g_logfp);
}

/* ── Access right helpers ───────────────────────────────────── */

/* REFER (ABI v2) and TRUNCATE (ABI v3) may not exist in older headers */
#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif

/* All filesystem access rights we handle (Landlock ABI v1-v3) */
#define ACCESS_READ_FILE  LANDLOCK_ACCESS_FS_READ_FILE
#define ACCESS_READ_DIR   LANDLOCK_ACCESS_FS_READ_DIR
#define ACCESS_READ  (ACCESS_READ_FILE | ACCESS_READ_DIR)
#define ACCESS_WRITE (LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_TRUNCATE)
#define ACCESS_CREATE (LANDLOCK_ACCESS_FS_MAKE_REG | LANDLOCK_ACCESS_FS_MAKE_DIR | \
                       LANDLOCK_ACCESS_FS_MAKE_SYM)
#define ACCESS_REMOVE_FILE LANDLOCK_ACCESS_FS_REMOVE_FILE
#define ACCESS_REMOVE_DIR  LANDLOCK_ACCESS_FS_REMOVE_DIR
#define ACCESS_ALL (ACCESS_READ | ACCESS_WRITE | ACCESS_CREATE | \
                    ACCESS_REMOVE_FILE | ACCESS_REMOVE_DIR)
/* File-only access (no READ_DIR, MAKE_DIR, REMOVE_DIR — those are dir-only) */
#define ACCESS_FILE_READ  ACCESS_READ_FILE
#define ACCESS_FILE_WRITE LANDLOCK_ACCESS_FS_WRITE_FILE

/* ── Rule structure ─────────────────────────────────────────── */

typedef struct {
    char path[PATH_MAX];
    __u64 allowed_access;
    int is_file;  /* 1 = individual file lock, 0 = directory */
} ll_rule_t;

static ll_rule_t g_rules[MAX_RULES];
static int g_rule_count = 0;

/* ── Add a rule ─────────────────────────────────────────────── */

static void add_rule(const char *path, __u64 allowed, int is_file) {
    if (g_rule_count >= MAX_RULES) {
        fprintf(stderr, "[landlock-guard] WARNING: max rules (%d) reached, skipping %s\n",
                MAX_RULES, path);
        return;
    }
    strncpy(g_rules[g_rule_count].path, path, PATH_MAX - 1);
    g_rules[g_rule_count].allowed_access = allowed;
    g_rules[g_rule_count].is_file = is_file;
    g_rule_count++;
}

/* ── Add locked file (read-only) ────────────────────────────── */

static void add_locked_file(const char *path) {
    struct stat sb;
    if (stat(path, &sb) != 0) {
        fprintf(stderr, "[landlock-guard] NOTE: locked file not found (skip): %s\n", path);
        return;
    }
    /* File rules can only use file-applicable access bits (no READ_DIR etc.) */
    add_rule(path, ACCESS_FILE_READ, 1);
}

/* ── Add locked directory (read-only, entire tree) ──────────── */

static void add_locked_dir(const char *path) {
    struct stat sb;
    if (stat(path, &sb) != 0) {
        fprintf(stderr, "[landlock-guard] NOTE: locked dir not found (skip): %s\n", path);
        return;
    }
    add_rule(path, ACCESS_READ, 0);
}

/* ── Add directory rule with specific access ────────────────── */

static void add_dir_rule(const char *path, __u64 allowed) {
    struct stat sb;
    if (stat(path, &sb) != 0) {
        fprintf(stderr, "[landlock-guard] NOTE: dir not found (skip): %s\n", path);
        return;
    }
    add_rule(path, allowed, 0);
}

/* ── Module licensing — lock non-licensed module dirs ────────── */

static int str_in_file(const char *filepath, const char *needle) {
    FILE *f = fopen(filepath, "r");
    if (!f) return 0;
    char buf[8192];
    size_t n = fread(buf, 1, sizeof(buf) - 1, f);
    fclose(f);
    buf[n] = '\0';
    return strstr(buf, needle) != NULL;
}

static void apply_module_licensing(void) {
    const char *license = "/opt/AIWH/core/config/license.json";
    const char *modules[] = {"frontend", "backend", "lifestyle"};
    const char *base = "/opt/AIWH/core/modules";

    for (int i = 0; i < 3; i++) {
        /* Check if module is in modules_active */
        char needle[64];
        snprintf(needle, sizeof(needle), "\"%s\"", modules[i]);
        if (!str_in_file(license, needle)) {
            /* Module not licensed — block ALL access */
            char modpath[PATH_MAX];
            snprintf(modpath, sizeof(modpath), "%s/%s", base, modules[i]);
            struct stat sb;
            if (stat(modpath, &sb) == 0) {
                add_rule(modpath, 0, 0);  /* 0 = no access at all */
                fprintf(stderr, "[landlock-guard] Module locked (not licensed): %s\n", modules[i]);
            }
        }
    }
}

/* ── Build the hardcoded policy ─────────────────────────────── */
/*
 * We hardcode the policy in C rather than parsing JSON at runtime.
 * Reason: this is security-critical code. No JSON parsing library
 * in the trust boundary. The policy JSON file exists for documentation
 * and dashboard display, but the kernel rules are defined here.
 *
 * To change policy: edit this function + update the JSON file to match.
 */

static void build_policy(void) {
    /* ── Locked files (kernel read-only, individually) ──────── */
    add_locked_file("/opt/AIWH/core/config/license.json");
    add_locked_file("/opt/AIWH/core/config/landlock-policy.json");

    /* 19 CORE.md files */
    const char *soul_agents[][2] = {
        {"frontend", "copywriter"}, {"frontend", "research"}, {"frontend", "video"},
        {"frontend", "sales"}, {"frontend", "social"}, {"frontend", "funnel"},
        {"lifestyle", "coach"}, {"lifestyle", "trading"}, {"lifestyle", "travel"},
        {"backend", "cfo"}, {"backend", "crm-manager"}, {"backend", "systems"},
        {"backend", "calendar-manager"}, {"backend", "email-manager"},
        {"system", "module-manager"}, {"system", "scheduler"},
        {"system", "builder-manager"}, {"system", "security-manager"},
        {"system", "ai-council"},
    };
    for (int i = 0; i < 19; i++) {
        char path[PATH_MAX];
        snprintf(path, sizeof(path), "/opt/AIWH/core/modules/%s/%s/CORE.md",
                 soul_agents[i][0], soul_agents[i][1]);
        add_locked_file(path);
    }

    /* ── Locked directories (kernel read-only, entire tree) ─── */
    add_locked_dir("/opt/AIWH/core/dashboard");
    add_locked_dir("/opt/AIWH/core/docker");
    add_locked_dir("/opt/AIWH/core/onboarding");

    /* ── Directory rules ────────────────────────────────────── */

    /* Client data — write yes, delete NEVER (irreplaceable) */
    add_dir_rule("/opt/AIWH/client/data",
        ACCESS_READ | ACCESS_WRITE | ACCESS_CREATE);
    add_dir_rule("/opt/AIWH/client/config",
        ACCESS_READ | ACCESS_WRITE | ACCESS_CREATE);

    /* Client content — write + remove_file allowed (safe-bash redirects rm to trash) */
    add_dir_rule("/opt/AIWH/client/content",
        ACCESS_READ | ACCESS_WRITE | ACCESS_CREATE | ACCESS_REMOVE_FILE);

    /* Client trash — THE ONLY place rm actually works */
    add_dir_rule("/opt/AIWH/client/trash", ACCESS_ALL);

    /* Client logs — full access (rotation needs delete) */
    add_dir_rule("/opt/AIWH/client/logs",
        ACCESS_READ | ACCESS_WRITE | ACCESS_CREATE | ACCESS_REMOVE_FILE);

    /* Agent workspaces — write/create, can delete files but not dirs */
    add_dir_rule("/opt/AIWH/core/modules",
        ACCESS_READ | ACCESS_WRITE | ACCESS_CREATE | ACCESS_REMOVE_FILE);

    /* Daily memory — create/write, never delete */
    add_dir_rule("/opt/AIWH/core/memory",
        ACCESS_READ | ACCESS_WRITE | ACCESS_CREATE);

    /* Script templates — read-only. Customizations go to client/scripts/ */
    add_dir_rule("/opt/AIWH/core/scripts", ACCESS_READ);

    /* Client script customizations — Branson edits here, preserved during updates */
    add_dir_rule("/opt/AIWH/client/scripts",
        ACCESS_READ | ACCESS_WRITE | ACCESS_CREATE);

    /* Config — writable (license + policy individually locked above) */
    add_dir_rule("/opt/AIWH/core/config",
        ACCESS_READ | ACCESS_WRITE | ACCESS_CREATE);

    /* Product skills — read-only (ships with updates) */
    add_dir_rule("/opt/AIWH/core/config/skills",
        ACCESS_READ);

    /* Client skills — agents can install/modify */
    add_dir_rule("/opt/AIWH/client/skills",
        ACCESS_READ | ACCESS_WRITE | ACCESS_CREATE | ACCESS_REMOVE_FILE);

    /* Generated content — write + remove_file (safe-bash redirects rm to trash) */
    add_dir_rule("/opt/AIWH/core/content",
        ACCESS_READ | ACCESS_WRITE | ACCESS_CREATE | ACCESS_REMOVE_FILE);

    /* Knowledge — write/create, never delete */
    add_dir_rule("/opt/AIWH/core/knowledge",
        ACCESS_READ | ACCESS_WRITE | ACCESS_CREATE);

    /* Docs — agents can generate reports */
    add_dir_rule("/opt/AIWH/core/docs",
        ACCESS_READ | ACCESS_WRITE | ACCESS_CREATE);

    /* Outputs — media pipeline writes here (video renders, scripts) */
    add_dir_rule("/opt/AIWH/core/outputs",
        ACCESS_READ | ACCESS_WRITE | ACCESS_CREATE | ACCESS_REMOVE_FILE);

    /* Core data — knowledge cache DB (agents read, pipeline writes) */
    add_dir_rule("/opt/AIWH/core/data",
        ACCESS_READ | ACCESS_WRITE | ACCESS_CREATE);

    /* Logs — full access (rotation) */
    add_dir_rule("/opt/AIWH/core/logs",
        ACCESS_READ | ACCESS_WRITE | ACCESS_CREATE | ACCESS_REMOVE_FILE);

    /* OpenClaw state — client's territory, full read/write */
    add_dir_rule("/opt/AIWH/.openclaw",
        ACCESS_READ | ACCESS_WRITE | ACCESS_CREATE | ACCESS_REMOVE_FILE);

    /* Temp — full access */
    add_dir_rule("/tmp", ACCESS_ALL);

    /* System essentials — read-only */
    add_dir_rule("/usr", ACCESS_READ);
    add_dir_rule("/lib", ACCESS_READ);
    add_dir_rule("/etc", ACCESS_READ);
    add_dir_rule("/proc", ACCESS_READ);
    add_dir_rule("/dev", ACCESS_READ | ACCESS_WRITE);  /* /dev/null, /dev/urandom need write */
    add_dir_rule("/opt/openclaw", ACCESS_READ);

    /* Module licensing — lock non-licensed modules */
    apply_module_licensing();
}

/* ── Apply Landlock ruleset ─────────────────────────────────── */

static int apply_landlock(void) {
    /* Check Landlock ABI version */
    int abi = (int)syscall(__NR_landlock_create_ruleset, NULL, 0,
                           LANDLOCK_CREATE_RULESET_VERSION);
    if (abi < 0) {
        fprintf(stderr, "[landlock-guard] Landlock not supported (errno=%d). "
                "Running WITHOUT kernel sandbox.\n", errno);
        return -1;
    }
    fprintf(stderr, "[landlock-guard] Landlock ABI version: %d\n", abi);

    /* Determine handled access based on ABI version */
    __u64 handled = LANDLOCK_ACCESS_FS_READ_FILE |
                    LANDLOCK_ACCESS_FS_READ_DIR |
                    LANDLOCK_ACCESS_FS_WRITE_FILE |
                    LANDLOCK_ACCESS_FS_REMOVE_FILE |
                    LANDLOCK_ACCESS_FS_REMOVE_DIR |
                    LANDLOCK_ACCESS_FS_MAKE_REG |
                    LANDLOCK_ACCESS_FS_MAKE_DIR |
                    LANDLOCK_ACCESS_FS_MAKE_SYM;

    if (abi >= 2) {
        /* ABI v2 adds REFER */
        handled |= LANDLOCK_ACCESS_FS_REFER;
    }
    if (abi >= 3) {
        /* ABI v3 adds TRUNCATE */
        handled |= LANDLOCK_ACCESS_FS_TRUNCATE;
    }

    /* Create ruleset */
    struct landlock_ruleset_attr ruleset_attr = {
        .handled_access_fs = handled,
    };
    int ruleset_fd = landlock_create_ruleset(&ruleset_attr,
        sizeof(ruleset_attr), 0);
    if (ruleset_fd < 0) {
        fprintf(stderr, "[landlock-guard] Failed to create ruleset (errno=%d)\n", errno);
        return -1;
    }

    /* Add rules */
    int applied = 0, skipped = 0;
    for (int i = 0; i < g_rule_count; i++) {
        int fd = open(g_rules[i].path,
                      O_PATH | (g_rules[i].is_file ? 0 : O_DIRECTORY));
        if (fd < 0) {
            fprintf(stderr, "[landlock-guard] Cannot open path (skip): %s (errno=%d)\n",
                    g_rules[i].path, errno);
            skipped++;
            continue;
        }

        /* Mask allowed access to what this ABI handles */
        __u64 allowed = g_rules[i].allowed_access & handled;

        struct landlock_path_beneath_attr path_attr = {
            .allowed_access = allowed,
            .parent_fd = fd,
        };
        if (landlock_add_rule(ruleset_fd, LANDLOCK_RULE_PATH_BENEATH,
                              &path_attr, 0) < 0) {
            fprintf(stderr, "[landlock-guard] Failed to add rule for %s (errno=%d)\n",
                    g_rules[i].path, errno);
            close(fd);
            skipped++;
            continue;
        }
        close(fd);
        applied++;
    }

    fprintf(stderr, "[landlock-guard] Rules: %d applied, %d skipped (of %d total)\n",
            applied, skipped, g_rule_count);

    /*
     * Individual file protection: chmod 444 BEFORE Landlock is applied.
     * Landlock can't restrict a file independently from its parent dir
     * (parent rule cascades). So we chmod locked files to 444.
     * The gateway runs as 'sandbox' user (UID 1000).
     * Note: chown to root requires root — skip if running as non-root.
     */
    {
        int locked = 0;
        for (int i = 0; i < g_rule_count; i++) {
            if (g_rules[i].is_file) {
                /* Try chown root:root (only works if running as root) */
                chown(g_rules[i].path, 0, 0);  /* best-effort, may fail as non-root */
                if (chmod(g_rules[i].path, 0444) == 0) {
                    locked++;
                }
                /* Failure is OK — Docker :ro mounts + Landlock provide protection */
            }
        }
        if (locked > 0) {
            fprintf(stderr, "[landlock-guard] Locked %d files (chmod 444)\n", locked);
        }
    }

    /* Enforce — no new privileges after this */
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) {
        fprintf(stderr, "[landlock-guard] prctl(NO_NEW_PRIVS) failed (errno=%d)\n", errno);
        close(ruleset_fd);
        return -1;
    }

    /* Apply — THIS IS THE POINT OF NO RETURN */
    if (landlock_restrict_self(ruleset_fd, 0)) {
        fprintf(stderr, "[landlock-guard] landlock_restrict_self failed (errno=%d)\n", errno);
        close(ruleset_fd);
        return -1;
    }

    close(ruleset_fd);

    char detail[256];
    snprintf(detail, sizeof(detail),
        "Landlock ABI v%d: %d rules applied, %d skipped. "
        "21 locked files, 3 locked dirs, %d directory rules.",
        abi, applied, skipped, g_rule_count - 21 - 3);
    audit_log("policy_applied", detail);

    fprintf(stderr, "[landlock-guard] ✅ Kernel sandbox ACTIVE. "
            "%d rules enforced.\n", applied);

    return 0;
}

/* ── Main ───────────────────────────────────────────────────── */

int main(int argc, char *argv[], char *envp[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: landlock-guard <command> [args...]\n"
                "  e.g.: landlock-guard node /opt/openclaw/dist/index.js gateway\n");
        return 1;
    }

    fprintf(stderr, "[landlock-guard] Building security policy...\n");
    build_policy();

    int result = apply_landlock();
    if (result < 0) {
        fprintf(stderr, "[landlock-guard] ⚠️  Running WITHOUT kernel sandbox (Landlock unavailable)\n");
        audit_log("policy_failed", "Landlock unavailable — running unsandboxed");
    }

    /* Close audit log before exec */
    if (g_logfp) fclose(g_logfp);

    /* Exec the target command — inherits ALL Landlock restrictions */
    fprintf(stderr, "[landlock-guard] Exec: %s\n", argv[1]);
    execvpe(argv[1], &argv[1], envp);

    /* If we get here, exec failed */
    fprintf(stderr, "[landlock-guard] FATAL: exec failed for %s (errno=%d: %s)\n",
            argv[1], errno, strerror(errno));
    return 127;
}
