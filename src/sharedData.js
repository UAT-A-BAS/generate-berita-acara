(function attachSharedDataCodec(root) {
  "use strict";

  const DATA_PREFIX = "data:";
  const KEYED_ARRAY_FIELDS = new Set(["groups", "rows", "makers", "comments", "replies"]);
  const ARRAY_ID_FIELDS = ["uid", "cid", "rid"];
  const POSITION_FIELD = "$position";
  const LEGACY_STAMP = 0;
  const LEGACY_AUTHOR = "legacy";

  function cloneValue(value) {
    if (value == null || typeof value !== "object") return value;
    return JSON.parse(JSON.stringify(value));
  }

  function encodePath(path) {
    return `${DATA_PREFIX}${JSON.stringify(path)}`;
  }

  function decodePath(key) {
    if (typeof key !== "string" || !key.startsWith(DATA_PREFIX)) return null;
    try {
      const path = JSON.parse(key.slice(DATA_PREFIX.length));
      return Array.isArray(path) ? path : null;
    } catch {
      return null;
    }
  }

  function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function arrayItemId(value) {
    if (!isPlainObject(value)) return "";
    const field = ARRAY_ID_FIELDS.find((name) => value[name]);
    return field ? String(value[field]) : "";
  }

  // A shared entry is stored as a versioned node `{ v, t, by }` (or `{ d: true, t, by }`
  // for a deletion) so that every field carries its own logical timestamp. Raw legacy
  // values written by older builds are read as nodes stamped 0 by "legacy".
  function isSharedNode(value) {
    return isPlainObject(value)
      && typeof value.t === "number"
      && typeof value.by === "string"
      && ("v" in value || value.d === true);
  }

  function asSharedNode(value) {
    return isSharedNode(value) ? value : { v: cloneValue(value), t: LEGACY_STAMP, by: LEGACY_AUTHOR };
  }

  function nodeValue(node) {
    if (!isSharedNode(node)) return cloneValue(node);
    return node.d === true ? undefined : cloneValue(node.v);
  }

  function nodeStamp(node) {
    return isSharedNode(node) ? Number(node.t) || 0 : LEGACY_STAMP;
  }

  function maxSharedStamp(sharedState) {
    return sharedEntries(sharedState).reduce((max, [, value]) => Math.max(max, nodeStamp(value)), 0);
  }

  function shouldUseKeyedArray(value, path) {
    const field = String(path.at(-1) || "");
    if (KEYED_ARRAY_FIELDS.has(field)) return value.every((item) => !item || arrayItemId(item));
    return value.length > 0 && value.every((item) => arrayItemId(item));
  }

  function flattenSharedData(value, path = [], output = new Map()) {
    if (Array.isArray(value)) {
      if (!shouldUseKeyedArray(value, path)) {
        output.set(encodePath(path), cloneValue(value));
        return output;
      }
      output.set(encodePath(path), { __baKind: "keyed-array" });
      value.forEach((item, index) => {
        const id = arrayItemId(item);
        if (!id) return;
        const itemPath = [...path, `@${id}`];
        flattenSharedData(item, itemPath, output);
        output.set(encodePath([...itemPath, POSITION_FIELD]), index);
      });
      return output;
    }

    if (isPlainObject(value)) {
      output.set(encodePath(path), { __baKind: "object" });
      Object.keys(value).sort().forEach((key) => {
        flattenSharedData(value[key], [...path, key], output);
      });
      return output;
    }

    output.set(encodePath(path), value);
    return output;
  }

  function buildTree(entries) {
    const tree = { children: new Map(), hasValue: false, value: undefined };
    entries.forEach(([key, value]) => {
      const path = decodePath(key);
      if (!path) return;
      let node = tree;
      path.forEach((segment) => {
        if (!node.children.has(segment)) {
          node.children.set(segment, { children: new Map(), hasValue: false, value: undefined });
        }
        node = node.children.get(segment);
      });
      node.hasValue = true;
      node.value = cloneValue(value);
    });
    return tree;
  }

  function decodeTreeNode(node) {
    const marker = isPlainObject(node.value) ? node.value.__baKind : "";
    if (marker === "keyed-array") {
      return [...node.children.entries()]
        .filter(([key]) => String(key).startsWith("@"))
        .map(([key, child]) => {
          const item = decodeTreeNode(child);
          const positionNode = child.children.get(POSITION_FIELD);
          const position = Number(positionNode?.value);
          return {
            id: String(key).slice(1),
            item,
            position: Number.isFinite(position) ? position : Number.MAX_SAFE_INTEGER
          };
        })
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
        .map(({ item }) => item);
    }

    if (marker === "object" || node.children.size) {
      const object = {};
      node.children.forEach((child, key) => {
        if (key === POSITION_FIELD) return;
        object[key] = decodeTreeNode(child);
      });
      return object;
    }

    return cloneValue(node.value);
  }

  function sharedEntries(sharedState) {
    if (!sharedState?.entries) return [];
    return [...sharedState.entries()].filter(([key]) => decodePath(key));
  }

  function hasSharedData(sharedState) {
    return hasSharedNodes(sharedState) || Boolean(sharedState?.get?.("data"));
  }

  function readSharedData(sharedState) {
    const entries = sharedEntries(sharedState);
    const live = entries
      .map(([key, value]) => [key, asSharedNode(value)])
      .filter(([, node]) => node.d !== true)
      .map(([key, node]) => [key, node.v]);
    if (live.length) return decodeTreeNode(buildTree(live));
    const legacy = sharedState?.get?.("data");
    if (isSharedNode(legacy)) return null;
    return cloneValue(legacy || null);
  }

  function sameValue(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  // Diffs the committed payload against the last state this editor actually agreed on.
  // Only genuine local edits become writes, so a field that merely has not been
  // re-rendered yet is never mistaken for "the user cleared it" and cannot clobber
  // a newer value that arrived from another peer.
  function changedPaths(baselineData, data) {
    const desired = flattenSharedData(data);
    const baseline = baselineData ? flattenSharedData(baselineData) : new Map();
    const writes = new Map();
    const deletes = [];
    desired.forEach((value, key) => {
      if (!baseline.has(key) || !sameValue(baseline.get(key), value)) writes.set(key, cloneValue(value));
    });
    baseline.forEach((value, key) => {
      if (!desired.has(key)) deletes.push(key);
    });
    return { writes, deletes };
  }

  function commitSharedChanges(sharedState, changes, options = {}) {
    const timestamp = Number.isFinite(Number(options.timestamp)) ? Number(options.timestamp) : Date.now();
    const author = String(options.author || options.actor || "unknown");
    const written = [];
    const removed = [];
    const skipped = [];
    (changes?.writes || new Map()).forEach((value, key) => {
      const current = asSharedNode(sharedState.get(key));
      if (current.d !== true && sameValue(nodeValue(current), value)) {
        skipped.push(key);
        return;
      }
      sharedState.set(key, { v: cloneValue(value), t: timestamp, by: author });
      written.push(key);
    });
    (changes?.deletes || []).forEach((key) => {
      if (sharedState.get(key) === undefined) {
        skipped.push(key);
        return;
      }
      sharedState.set(key, { d: true, t: timestamp, by: author });
      removed.push(key);
    });
    return { written, removed, skipped, timestamp };
  }

  function sameNode(left, right) {
    if (!isSharedNode(left) || !isSharedNode(right)) return false;
    return left.t === right.t
      && left.by === right.by
      && Boolean(left.d) === Boolean(right.d)
      && sameValue(left.d === true ? null : left.v, right.d === true ? null : right.v);
  }

  function hasSharedNodes(sharedState) {
    return sharedEntries(sharedState).some(([, value]) => asSharedNode(value).d !== true);
  }

  function hasLegacySnapshot(sharedState) {
    const legacy = sharedState?.get?.("data");
    return Boolean(legacy) && !isSharedNode(legacy) && isPlainObject(legacy);
  }

  // Writes only the paths that actually changed, each with its own logical stamp.
  // Paths that disappeared locally become tombstones so a stale peer cannot resurrect them.
  function mergeSharedData(sharedState, data, options = {}) {
    const timestamp = Number.isFinite(Number(options.timestamp)) ? Number(options.timestamp) : Date.now();
    const author = String(options.author || options.actor || "unknown");
    const desired = flattenSharedData(data);
    const existing = new Map();
    sharedEntries(sharedState).forEach(([key, value]) => {
      const node = asSharedNode(value);
      existing.set(key, { node, value: node.d === true ? undefined : node.v });
    });

    const written = [];
    const removed = [];
    const skipped = [];
    desired.forEach((value, key) => {
      const current = existing.get(key);
      if (current && current.node.d !== true && sameValue(current.value, value)) {
        skipped.push(key);
        return;
      }
      sharedState.set(key, { v: cloneValue(value), t: timestamp, by: author });
      written.push(key);
    });
    existing.forEach((current, key) => {
      if (desired.has(key) || current.node.d === true) return;
      sharedState.set(key, { d: true, t: timestamp, by: author });
      removed.push(key);
    });

    return { written, removed, skipped, timestamp };
  }

  // Keeps a peer's newer value, re-asserts a locally owned newer value once so that
  // concurrent edits to the same field converge on the highest logical stamp.
  function reassertSharedNodes(sharedState, pendingNodes, options = {}) {
    if (!pendingNodes?.size) return { reasserted: [], yielded: [] };
    const author = String(options.author || options.actor || "unknown");
    const reasserted = [];
    const yielded = [];
    [...pendingNodes.entries()].forEach(([key, node]) => {
      const current = sharedState.get(key);
      if (current === undefined) {
        sharedState.set(key, { ...node, by: node.by || author });
        reasserted.push(key);
        return;
      }
      const currentStamp = nodeStamp(current);
      if (currentStamp > nodeStamp(node)) {
        pendingNodes.delete(key);
        yielded.push(key);
        return;
      }
      if (isSharedNode(current) && sameValue(current, node)) return;
      sharedState.set(key, { ...node, by: node.by || author });
      reasserted.push(key);
    });
    return { reasserted, yielded };
  }

  function pendingNodePatch(changes, sharedState, timestamp, author) {
    const pending = new Map();
    (changes?.written || []).forEach((key) => {
      const node = sharedState.get(key);
      if (node !== undefined) pending.set(key, cloneValue(node));
    });
    (changes?.removed || []).forEach((key) => {
      pending.set(key, { d: true, t: timestamp, by: author });
    });
    return pending;
  }

  function syncSharedData(sharedState, data) {
    const changes = mergeSharedData(sharedState, data, { timestamp: Date.now(), author: "sync" });
    sharedState.delete("data");
    return changes;
  }

  root.SharedDataCodec = Object.freeze({
    DATA_PREFIX,
    changedPaths,
    commitSharedChanges,
    flattenSharedData,
    hasLegacySnapshot,
    hasSharedNodes,
    hasSharedData,
    isSharedNode,
    mergeSharedData,
    maxSharedStamp,
    nodeStamp,
    nodeValue,
    pendingNodePatch,
    readSharedData,
    reassertSharedNodes,
    syncSharedData
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
