(function attachSharedDataCodec(root) {
  "use strict";

  const DATA_PREFIX = "data:";
  const KEYED_ARRAY_FIELDS = new Set(["groups", "rows", "makers", "comments", "replies"]);
  const ARRAY_ID_FIELDS = ["uid", "cid", "rid"];
  const POSITION_FIELD = "$position";

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
    return sharedEntries(sharedState).length > 0 || Boolean(sharedState?.get?.("data"));
  }

  function readSharedData(sharedState) {
    const entries = sharedEntries(sharedState);
    if (entries.length) return decodeTreeNode(buildTree(entries));
    return cloneValue(sharedState?.get?.("data") || null);
  }

  function sameValue(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function syncSharedData(sharedState, data) {
    const desired = flattenSharedData(data);
    const existingKeys = sharedEntries(sharedState).map(([key]) => key);

    existingKeys.forEach((key) => {
      if (!desired.has(key)) sharedState.delete(key);
    });
    desired.forEach((value, key) => {
      if (!sameValue(sharedState.get(key), value)) sharedState.set(key, cloneValue(value));
    });
    sharedState.delete("data");
  }

  root.SharedDataCodec = Object.freeze({
    DATA_PREFIX,
    flattenSharedData,
    hasSharedData,
    readSharedData,
    syncSharedData
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
