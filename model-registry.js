'use strict';
const fs = require('fs');
const path = require('path');

class ModelRegistry {
  constructor({ dir = './models/registry', logger = console } = {}) { this.dir = dir; this.logger = logger; fs.mkdirSync(dir, { recursive: true }); }
  register({ modelId, modelType = 'unknown', features = [], metrics = {}, parent = null, status = 'candidate' } = {}) {
    if (!modelId) throw new Error('modelId required');
    const meta = { modelId, modelType, features, metrics, parent, status, createdAt: new Date().toISOString() };
    fs.writeFileSync(path.join(this.dir, `${modelId}.json`), JSON.stringify(meta, null, 2));
    fs.writeFileSync(path.join(this.dir, 'latest.json'), JSON.stringify(meta, null, 2));
    return meta;
  }
  get(modelId) { try { return JSON.parse(fs.readFileSync(path.join(this.dir, `${modelId}.json`), 'utf8')); } catch (_) { return null; } }
  latest() { try { return JSON.parse(fs.readFileSync(path.join(this.dir, 'latest.json'), 'utf8')); } catch (_) { return null; } }
  promote(modelId) { const m = this.get(modelId); if (!m) throw new Error(`model not found: ${modelId}`); m.status = 'production'; m.promotedAt = new Date().toISOString(); fs.writeFileSync(path.join(this.dir, `${modelId}.json`), JSON.stringify(m, null, 2)); fs.writeFileSync(path.join(this.dir, 'production.json'), JSON.stringify(m, null, 2)); return m; }
  production() { try { return JSON.parse(fs.readFileSync(path.join(this.dir, 'production.json'), 'utf8')); } catch (_) { return null; } }
}
module.exports = { ModelRegistry };
