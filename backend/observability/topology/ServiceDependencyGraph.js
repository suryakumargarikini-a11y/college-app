'use strict';

/**
 * ServiceDependencyGraph.js
 * SITAM Smart ERP — Service Topology & Dependency Registry
 *
 * Maintains a live service topology registry mapping relationships between the
 * API server, postgres, redis, browser pool, queue workers, and mobile interfaces.
 */

const logger = require('../../services/logger');

class ServiceDependencyGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this._bootstrapTopology();
  }

  _bootstrapTopology() {
    const components = [
      { name: 'frontend', type: 'UI' },
      { name: 'api-server', type: 'service' },
      { name: 'queue-worker', type: 'worker' },
      { name: 'browser-pool', type: 'pool' },
      { name: 'postgres', type: 'database' },
      { name: 'redis', type: 'cache' }
    ];

    for (const c of components) {
      this.addNode(c.name, c);
    }

    this.addEdge('frontend', 'api-server');
    this.addEdge('api-server', 'postgres');
    this.addEdge('api-server', 'redis');
    this.addEdge('api-server', 'queue-worker');
    this.addEdge('queue-worker', 'redis');
    this.addEdge('queue-worker', 'postgres');
    this.addEdge('queue-worker', 'browser-pool');
  }

  addNode(name, metadata = {}) {
    this.nodes.set(name, metadata);
    if (!this.edges.has(name)) {
      this.edges.set(name, new Set());
    }
  }

  addEdge(source, target) {
    if (!this.nodes.has(source)) this.addNode(source);
    if (!this.nodes.has(target)) this.addNode(target);
    this.edges.get(source).add(target);
  }

  getDependencies(name) {
    return Array.from(this.edges.get(name) || []);
  }

  getDependents(name) {
    const dependents = [];
    for (const [src, targets] of this.edges.entries()) {
      if (targets.has(name)) {
        dependents.push(src);
      }
    }
    return dependents;
  }

  getGraph() {
    const graph = { nodes: [], edges: [] };
    for (const [name, meta] of this.nodes.entries()) {
      graph.nodes.push({ name, ...meta });
    }
    for (const [src, targets] of this.edges.entries()) {
      for (const t of targets) {
        graph.edges.push({ source: src, target: t });
      }
    }
    return graph;
  }
}

module.exports = ServiceDependencyGraph;
