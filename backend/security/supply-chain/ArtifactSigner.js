'use strict';

/**
 * ArtifactSigner.js
 * SITAM Smart ERP — DevSecOps Supply Chain Security
 *
 * Implements HMAC-SHA256 signature signing for build artifacts, including
 * SLSA-compatible build provenance records. Saves metadata manifests and provides
 * validation interfaces for deployments.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../../services/logger');

class ArtifactSigner {
  constructor(options = {}) {
    this.manifestsDir = options.manifestsDir || path.resolve(__dirname, 'manifests');
    this.signingKey = process.env.ARTIFACT_SIGNING_KEY || crypto.createHash('sha256').update('sitam-smart-erp').digest('hex');
  }

  signArtifact(name, content) {
    logger.info(`[ArtifactSigner] Signing artifact: ${name}`);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const signature = crypto.createHmac('sha256', this.signingKey).update(hash).digest('hex');
    const timestamp = new Date().toISOString();
    const provenanceId = crypto.randomUUID();

    const record = {
      artifactName: name,
      artifactHash: hash,
      signature,
      algorithm: 'HMAC-SHA256',
      signingKeyId: 'default-hmac-key',
      timestamp,
      provenanceId
    };

    fs.mkdirSync(this.manifestsDir, { recursive: true });
    const manifestPath = path.join(this.manifestsDir, `${name}-manifest.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(record, null, 2), 'utf8');

    logger.info(`[ArtifactSigner] Signed manifest saved to ${manifestPath}`);
    return record;
  }

  generateProvenance(artifactName, artifactHash) {
    logger.info(`[ArtifactSigner] Generating SLSA provenance for ${artifactName}`);
    const provenance = {
      _type: 'https://in-toto.io/Statement/v0.1',
      subject: [
        {
          name: artifactName,
          digest: {
            sha256: artifactHash
          }
        }
      ],
      predicateType: 'https://slsa.dev/provenance/v0.2',
      predicate: {
        builder: {
          id: 'https://github.com/sitam-smart-erp/build-worker'
        },
        buildType: 'https://slsa.dev/conan/v1',
        invocation: {
          configSource: {
            uri: 'https://github.com/sitam-smart-erp/backend',
            digest: {
              sha256: artifactHash
            },
            entryPoint: 'build.js'
          },
          parameters: {},
          environment: {
            node_version: process.version,
            platform: process.platform
          }
        },
        metadata: {
          buildStartedOn: new Date().toISOString(),
          completeness: {
            parameters: true,
            environment: true,
            materials: false
          },
          reproducible: true
        },
        materials: [
          {
            uri: 'git+https://github.com/sitam-smart-erp/backend.git',
            digest: {
              sha256: artifactHash
            }
          }
        ]
      }
    };

    const signature = crypto.createHmac('sha256', this.signingKey).update(JSON.stringify(provenance)).digest('hex');
    const record = {
      provenance,
      signature,
      algorithm: 'HMAC-SHA256',
      timestamp: new Date().toISOString()
    };

    const provPath = path.join(this.manifestsDir, `${artifactName}-provenance.json`);
    fs.writeFileSync(provPath, JSON.stringify(record, null, 2), 'utf8');
    logger.info(`[ArtifactSigner] Provenance saved to ${provPath}`);

    return record;
  }

  listSignedArtifacts() {
    if (!fs.existsSync(this.manifestsDir)) return [];
    return fs.readdirSync(this.manifestsDir)
      .filter(f => f.endsWith('-manifest.json'))
      .map(f => {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.manifestsDir, f), 'utf8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  verifyArtifact(name, content) {
    const manifestPath = path.join(this.manifestsDir, `${name}-manifest.json`);
    if (!fs.existsSync(manifestPath)) {
      logger.warn(`[ArtifactSigner] Manifest not found for ${name}`);
      return false;
    }

    try {
      const record = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      if (record.artifactHash !== hash) {
        logger.warn(`[ArtifactSigner] Hash mismatch for ${name}`);
        return false;
      }

      const expectedSignature = crypto.createHmac('sha256', this.signingKey).update(hash).digest('hex');
      const valid = record.signature === expectedSignature;
      if (!valid) {
        logger.warn(`[ArtifactSigner] Signature verification failed for ${name}`);
      } else {
        logger.info(`[ArtifactSigner] Signature verified successfully for ${name}`);
      }
      return valid;
    } catch (err) {
      logger.error(`[ArtifactSigner] Verification error for ${name}: ${err.message}`);
      return false;
    }
  }

  signDockerImage(dockerfilePath) {
    if (!fs.existsSync(dockerfilePath)) {
      throw new Error(`Dockerfile not found at ${dockerfilePath}`);
    }
    const content = fs.readFileSync(dockerfilePath, 'utf8');
    return this.signArtifact('docker-image', content);
  }
  /**
   * Scheduler alias — reads the most-recent SBOM snapshot and signs it.
   * @param {SBOMGenerator} sbomGenerator - instance to read getLatest() from
   */
  signLatestSnapshot(sbomGenerator) {
    const latest = sbomGenerator && typeof sbomGenerator.getLatest === 'function'
      ? sbomGenerator.getLatest()
      : null;
    if (!latest) {
      logger.warn('[ArtifactSigner] signLatestSnapshot: no SBOM snapshot found — skipping.');
      return null;
    }
    const content = JSON.stringify(latest);
    return this.signArtifact('sbom-latest', content);
  }
}

module.exports = ArtifactSigner;
