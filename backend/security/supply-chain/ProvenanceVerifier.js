'use strict';

/**
 * ProvenanceVerifier.js
 * SITAM Smart ERP — DevSecOps Supply Chain Verification
 *
 * Verifies code artifact signatures and provenance manifests prior to deployment,
 * serving as a security gate in the CI/CD pipeline.
 */

const fs = require('fs');
const path = require('path');
const ArtifactSigner = require('./ArtifactSigner');
const logger = require('../../services/logger');

class ProvenanceVerifier {
  constructor(options = {}) {
    this.signer = new ArtifactSigner(options);
  }

  verify(name, filepath) {
    logger.info(`[ProvenanceVerifier] Verifying artifact: ${name} at ${filepath}`);
    if (!fs.existsSync(filepath)) {
      logger.error(`[ProvenanceVerifier] Artifact file not found: ${filepath}`);
      return false;
    }
    const content = fs.readFileSync(filepath);
    return this.signer.verifyArtifact(name, content);
  }

  verifyBuild() {
    const baseDir = path.resolve(__dirname, '../..');
    const items = [
      { name: 'server', path: path.join(baseDir, 'server.js') },
      { name: 'package', path: path.join(baseDir, 'package.json') }
    ];

    let allOk = true;
    for (const item of items) {
      if (fs.existsSync(item.path)) {
        const verified = this.verify(item.name, item.path);
        if (!verified) {
          logger.warn(`[ProvenanceVerifier] Build verification failed for component: ${item.name}`);
          allOk = false;
        }
      }
    }
    return allOk;
  }
}

module.exports = ProvenanceVerifier;
