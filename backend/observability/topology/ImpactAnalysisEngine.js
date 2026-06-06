'use strict';

/**
 * ImpactAnalysisEngine.js
 * SITAM Smart ERP — Topology Impact Analysis Engine
 *
 * Traverses the service dependency graph to map and calculate the downstream blast radius
 * and severity classification of a failure or degradation of any platform component.
 */

const ServiceDependencyGraph = require('./ServiceDependencyGraph');
const logger = require('../../services/logger');

class ImpactAnalysisEngine {
  constructor(options = {}) {
    this.graph = options.graph || new ServiceDependencyGraph();
  }

  analyzeImpact(failedServiceName) {
    logger.info(`[ImpactAnalysisEngine] Analyzing impact of failure on service: ${failedServiceName}`);
    
    if (!this.graph.nodes.has(failedServiceName)) {
      return { failedService: failedServiceName, impactedServices: [], riskLevel: 'LOW' };
    }

    const visited = new Set();
    const queue = [failedServiceName];

    while (queue.length > 0) {
      const current = queue.shift();
      const dependents = this.graph.getDependents(current);
      for (const d of dependents) {
        if (!visited.has(d)) {
          visited.add(d);
          queue.push(d);
        }
      }
    }

    const impacted = Array.from(visited);
    
    let riskLevel = 'LOW';
    if (impacted.includes('frontend') || failedServiceName === 'api-server') {
      riskLevel = 'CRITICAL';
    } else if (impacted.length > 2) {
      riskLevel = 'HIGH';
    } else if (impacted.length > 0) {
      riskLevel = 'MEDIUM';
    }

    logger.info(`[ImpactAnalysisEngine] Impact check complete. Risk: ${riskLevel}. Impacted downstream targets: ${impacted.join(', ')}`);
    return {
      failedService: failedServiceName,
      impactedServices: impacted,
      riskLevel
    };
  }
}

module.exports = ImpactAnalysisEngine;
