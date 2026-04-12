// ─── Routes: Cinematic Pipeline (split into 3 files) ─────────
module.exports = function(app, deps) {
  require('./cinematic-config')(app, deps);
  require('./cinematic-jobs')(app, deps);
  require('./cinematic-assets')(app, deps);
};
