'use strict';

/**
 * SBOMGenerator.js
 * SITAM Smart ERP — DevSecOps SBOM Automation
 *
 * Generates CycloneDX 1.4 compliant JSON and XML Software Bill of Materials.
 * Reads package.json and package-lock.json to track all dependencies, licenses,
 * and hashes. Supports snapshots, difference tracking, and emits Prometheus metrics.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../../services/logger');

class SBOMGenerator {
  constructor(options = {}) {
    this.packageJsonPath = options.packageJsonPath || path.resolve(__dirname, '../../package.json');
    this.packageLockJsonPath = options.packageLockJsonPath || path.resolve(__dirname, '../../package-lock.json');
    this.snapshotsDir = options.snapshotsDir || path.resolve(__dirname, 'snapshots');
    this.metrics = options.metrics || null;
    this._initMetrics();
  }

  _initMetrics() {
    if (!this.metrics) return;
    try {
      const { Gauge } = require('prom-client');
      this.sbomComponentCount = new Gauge({
        name: 'sbom_component_count',
        help: 'Total number of components in SBOM',
        registers: [this.metrics]
      });
      this.sbomHighRiskCount = new Gauge({
        name: 'sbom_high_risk_count',
        help: 'Number of high-risk components in SBOM',
        registers: [this.metrics]
      });
      this.sbomLastGeneratedTimestamp = new Gauge({
        name: 'sbom_last_generated_timestamp',
        help: 'Timestamp of last SBOM generation',
        registers: [this.metrics]
      });
    } catch (err) {
      logger.warn(`[SBOMGenerator] Failed to initialize Prometheus metrics: ${err.message}`);
    }
  }

  _publishMetrics(stats) {
    if (this.sbomComponentCount) {
      this.sbomComponentCount.set(stats.componentCount);
    }
    if (this.sbomHighRiskCount) {
      this.sbomHighRiskCount.set(stats.highRiskCount);
    }
    if (this.sbomLastGeneratedTimestamp) {
      this.sbomLastGeneratedTimestamp.set(Math.floor(Date.now() / 1000));
    }
  }

  generate() {
    logger.info('[SBOMGenerator] Starting SBOM generation...');
    if (!fs.existsSync(this.packageJsonPath) || !fs.existsSync(this.packageLockJsonPath)) {
      throw new Error('package.json or package-lock.json not found');
    }

    const pkg = JSON.parse(fs.readFileSync(this.packageJsonPath, 'utf8'));
    const lock = JSON.parse(fs.readFileSync(this.packageLockJsonPath, 'utf8'));

    const components = [];
    const dependencies = lock.dependencies || {};
    const packages = lock.packages || {};

    const cdProps = {
      bomFormat: 'CycloneDX',
      specVersion: '1.4',
      serialNumber: `urn:uuid:${crypto.randomUUID()}`,
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        tools: [
          {
            vendor: 'SITAM Smart ERP',
            name: 'SBOMGenerator',
            version: '1.0.0'
          }
        ],
        component: {
          group: 'org.sitams',
          name: pkg.name,
          version: pkg.version,
          type: 'application',
          purl: `pkg:npm/${pkg.name}@${pkg.version}`
        }
      }
    };

    const parseDeps = (deps) => {
      for (const [name, info] of Object.entries(deps)) {
        if (!name) continue;
        const version = info.version;
        const purl = `pkg:npm/${name}@${version}`;
        const hashes = [];
        if (info.integrity) {
          const parts = info.integrity.split('-');
          if (parts.length === 2) {
            hashes.push({
              alg: parts[0] === 'sha512' ? 'SHA-512' : parts[0] === 'sha256' ? 'SHA-256' : parts[0] === 'sha1' ? 'SHA-1' : 'MD5',
              content: parts[1]
            });
          }
        }
        components.push({
          type: 'library',
          name,
          version,
          purl,
          hashes: hashes.length > 0 ? hashes : undefined,
          licenses: info.license ? [{ license: { id: info.license } }] : undefined
        });
      }
    };

    if (Object.keys(packages).length > 0) {
      for (const [pkgPath, info] of Object.entries(packages)) {
        if (pkgPath === '') continue;
        
        let name = pkgPath;
        if (pkgPath.startsWith('node_modules/')) {
          const parts = pkgPath.split('node_modules/');
          name = parts[parts.length - 1];
        }
        
        if (!name) continue;
        const version = info.version;
        const purl = `pkg:npm/${name}@${version}`;
        const hashes = [];
        if (info.integrity) {
          const parts = info.integrity.split('-');
          if (parts.length === 2) {
            let alg = 'SHA-512';
            if (parts[0] === 'sha256') alg = 'SHA-256';
            if (parts[0] === 'sha1') alg = 'SHA-1';
            hashes.push({
              alg,
              content: parts[1]
            });
          }
        }
        components.push({
          type: 'library',
          name,
          version,
          purl,
          hashes: hashes.length > 0 ? hashes : undefined,
          licenses: info.license ? [{ license: { id: info.license } }] : undefined
        });
      }
    } else {
      parseDeps(dependencies);
    }

    cdProps.components = components;

    const dateStr = new Date().toISOString().split('T')[0];
    fs.mkdirSync(this.snapshotsDir, { recursive: true });
    const jsonPath = path.join(this.snapshotsDir, `sbom-${dateStr}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(cdProps, null, 2), 'utf8');

    const xml = this._toXml(cdProps);
    const xmlPath = path.join(this.snapshotsDir, `sbom-${dateStr}.xml`);
    fs.writeFileSync(xmlPath, xml, 'utf8');

    const riskSummary = this.getRiskSummary(components);
    this._publishMetrics({
      componentCount: components.length,
      highRiskCount: riskSummary.highRiskCount
    });

    logger.info(`[SBOMGenerator] SBOM generated successfully: ${components.length} components. JSON saved to ${jsonPath}, XML to ${xmlPath}`);

    return {
      jsonPath,
      xmlPath,
      componentCount: components.length,
      riskSummary
    };
  }

  _toXml(json) {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<bom xmlns="http://cyclonedx.org/schema/bom/1.4" serialNumber="${json.serialNumber}" version="${json.version}">\n`;
    xml += `  <metadata>\n`;
    xml += `    <timestamp>${json.metadata.timestamp}</timestamp>\n`;
    xml += `    <tools>\n`;
    xml += `      <tool>\n`;
    xml += `        <vendor>${json.metadata.tools[0].vendor}</vendor>\n`;
    xml += `        <name>${json.metadata.tools[0].name}</name>\n`;
    xml += `        <version>${json.metadata.tools[0].version}</version>\n`;
    xml += `      </tool>\n`;
    xml += `    </tools>\n`;
    xml += `    <component type="${json.metadata.component.type}">\n`;
    xml += `      <name>${json.metadata.component.name}</name>\n`;
    xml += `      <version>${json.metadata.component.version}</version>\n`;
    xml += `      <purl>${json.metadata.component.purl}</purl>\n`;
    xml += `    </component>\n`;
    xml += `  </metadata>\n`;
    xml += `  <components>\n`;
    for (const c of json.components) {
      xml += `    <component type="${c.type}">\n`;
      xml += `      <name>${c.name}</name>\n`;
      xml += `      <version>${c.version}</version>\n`;
      xml += `      <purl>${c.purl}</purl>\n`;
      if (c.licenses && c.licenses.length > 0) {
        xml += `      <licenses>\n`;
        for (const lic of c.licenses) {
          if (lic.license && lic.license.id) {
            xml += `        <license>\n`;
            xml += `          <id>${lic.license.id}</id>\n`;
            xml += `        </license>\n`;
          }
        }
        xml += `      </licenses>\n`;
      }
      if (c.hashes && c.hashes.length > 0) {
        xml += `      <hashes>\n`;
        for (const h of c.hashes) {
          xml += `        <hash alg="${h.alg}">${h.content}</hash>\n`;
        }
        xml += `      </hashes>\n`;
      }
      xml += `    </component>\n`;
    }
    xml += `  </components>\n`;
    xml += `</bom>\n`;
    return xml;
  }

  getRiskSummary(components = []) {
    let highRiskCount = 0;
    const details = [];
    const riskyLicenses = ['GPL', 'AGPL', 'LGPL', 'MPL', 'CC-BY-NC'];

    for (const c of components) {
      const lics = c.licenses || [];
      const licenseIds = lics.map(l => l.license?.id || '').filter(Boolean);
      const copyleft = licenseIds.some(id => riskyLicenses.some(rl => id.toUpperCase().includes(rl)));
      if (copyleft) {
        highRiskCount++;
        details.push({
          packageName: c.name,
          version: c.version,
          reason: `Copyleft license detected: ${licenseIds.join(', ')}`
        });
      }
    }

    return {
      highRiskCount,
      riskLevel: highRiskCount > 0 ? 'HIGH' : 'LOW',
      details
    };
  }

  getDiff(dateA, dateB) {
    const fileA = path.join(this.snapshotsDir, `sbom-${dateA}.json`);
    const fileB = path.join(this.snapshotsDir, `sbom-${dateB}.json`);

    if (!fs.existsSync(fileA) || !fs.existsSync(fileB)) {
      throw new Error(`One or both SBOM snapshots not found: ${dateA}, ${dateB}`);
    }

    const sbomA = JSON.parse(fs.readFileSync(fileA, 'utf8'));
    const sbomB = JSON.parse(fs.readFileSync(fileB, 'utf8'));

    const compsA = new Map(sbomA.components.map(c => [c.name, c.version]));
    const compsB = new Map(sbomB.components.map(c => [c.name, c.version]));

    const added = [];
    const removed = [];
    const upgraded = [];

    for (const [name, verB] of compsB.entries()) {
      if (!compsA.has(name)) {
        added.push({ name, version: verB });
      } else if (compsA.get(name) !== verB) {
        upgraded.push({ name, from: compsA.get(name), to: verB });
      }
    }

    for (const [name, verA] of compsA.entries()) {
      if (!compsB.has(name)) {
        removed.push({ name, version: verA });
      }
    }

    return { added, removed, upgraded };
  }

  getLatest() {
    if (!fs.existsSync(this.snapshotsDir)) return null;
    const files = fs.readdirSync(this.snapshotsDir).filter(f => f.startsWith('sbom-') && f.endsWith('.json'));
    if (files.length === 0) return null;
    files.sort().reverse();
    const latestFile = path.join(this.snapshotsDir, files[0]);
    return JSON.parse(fs.readFileSync(latestFile, 'utf8'));
  }

  /** Scheduler alias — calls generate() */
  generateSnapshot() { return this.generate(); }
}

module.exports = SBOMGenerator;
