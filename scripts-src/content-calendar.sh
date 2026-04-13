#!/bin/bash
set -euo pipefail
source /opt/AIWH/core/scripts/lib/env.sh

# Content Calendar — Shows upcoming content schedule with pillar rotation
# Usage: content-calendar.sh [--weeks N]

DB="${CLIENT_ROOT:-/opt/AIWH/client}/data/video-jobs.db"
WEEKS="${2:-4}"

python3 << PYEOF
import sqlite3, datetime, json

db = sqlite3.connect("$DB")
db.row_factory = sqlite3.Row

# 6-pillar rotation: 3-day cycle, 2 videos/day
# 3-day rotation: Day1=Demand Signals+Authority Engine, Day2=Traction Machine+Proof of Work, Day3=Operations Live+Compound Effect
day_in_cycle = datetime.date.today().toordinal() % 3  # 0,1,2
rotation = {0:('demand-signals','authority-engine'), 1:('traction-machine','proof-of-work'), 2:('operations-live','compound-effect')}
schedule_pillars = rotation  # keyed by day_in_cycle
pillar_colors = {'demand-signals':'🔵','authority-engine':'🟡','traction-machine':'🟢','proof-of-work':'🟠','operations-live':'🔴','compound-effect':'🟣'}

# Get all non-terminal jobs
jobs = db.execute("""
    SELECT job_id, topic, pillar, status, scheduled_for_date, priority, source, created_at
    FROM video_jobs 
    WHERE status NOT IN ('posted','rejected','voice_failed','avatar_failed','avatar_timeout','caption_failed','qa_failed','script_too_long')
    ORDER BY created_at ASC
""").fetchall()

# Build calendar for next N weeks
today = datetime.date.today()
weeks = $WEEKS

print(f"\n📅 Content Calendar — Next {weeks} weeks (2 videos/day, 3-day rotation)\n")
print(f"{'Date':<12} {'Day':<4} {'Pillar':<12} {'Status':<15} {'Topic'}")
print("-" * 90)

# Group drafts by pillar for assignment
drafts_by_pillar = {}
for j in jobs:
    if j['status'] == 'draft':
        p = j['pillar'] or 'unassigned'
        drafts_by_pillar.setdefault(p, []).append(j)

# Assigned jobs (non-draft, in pipeline)
pipeline_jobs = [j for j in jobs if j['status'] != 'draft']

used_job_ids = set()

for i in range(weeks * 7):
    d = today + datetime.timedelta(days=i)
    dow = d.weekday()
    day_cycle = (d.toordinal() % 3)
    pillars_today = rotation[day_cycle]
    pillar = pillars_today[0]  # primary pillar for this slot
    icon = pillar_colors.get(pillar, '⚪')
    
    # Check if any pipeline job is scheduled for this date
    assigned = None
    for j in pipeline_jobs:
        if j['scheduled_for_date'] == d.isoformat() and j['job_id'] not in used_job_ids:
            assigned = j
            used_job_ids.add(j['job_id'])
            break
    
    if not assigned and i == 0:
        # Today — check for in-pipeline jobs
        for j in pipeline_jobs:
            if j['job_id'] not in used_job_ids:
                assigned = j
                used_job_ids.add(j['job_id'])
                break
    
    if assigned:
        topic = assigned['topic'][:45]
        status = assigned['status']
        priority = ' ⚡' if assigned['priority'] == 'urgent' else ''
        print(f"{d.isoformat():<12} {d.strftime('%a'):<4} {icon} {pillar:<10} {status:<15}{priority} {topic}")
    else:
        # Check if we have a draft for this pillar
        if pillar in drafts_by_pillar and drafts_by_pillar[pillar]:
            draft = drafts_by_pillar[pillar].pop(0)
            topic = draft['topic'][:45]
            used_job_ids.add(draft['job_id'])
            print(f"{d.isoformat():<12} {d.strftime('%a'):<4} {icon} {pillar:<10} {'draft':<15} {topic}")
        else:
            # Fallback to any pillar draft
            fallback = None
            for p, ds in drafts_by_pillar.items():
                if ds:
                    fallback = ds.pop(0)
                    used_job_ids.add(fallback['job_id'])
                    break
            if fallback:
                topic = fallback['topic'][:45]
                print(f"{d.isoformat():<12} {d.strftime('%a'):<4} {icon} {pillar:<10} {'draft(fb)':<15} {topic}")
            else:
                print(f"{d.isoformat():<12} {d.strftime('%a'):<4} {icon} {pillar:<10} {'⚠️ EMPTY':<15}")

# Summary
print(f"\n📊 Queue Summary:")
total = db.execute("SELECT COUNT(*) FROM video_jobs WHERE status='draft'").fetchone()[0]
by_pillar = db.execute("SELECT pillar, COUNT(*) FROM video_jobs WHERE status='draft' GROUP BY pillar").fetchall()
print(f"  Total drafts: {total}")
for row in by_pillar:
    p = row[0] or 'unassigned'
    print(f"  {pillar_colors.get(p,'⚪')} {p}: {row[1]}")

urgent = db.execute("SELECT COUNT(*) FROM video_jobs WHERE status='urgent_review'").fetchone()[0]
if urgent:
    print(f"  🚨 Urgent reviews pending: {urgent}")

db.close()
PYEOF
