import assert from "node:assert/strict";
import * as Y from "yjs";

await import("../src/sharedData.js");

const { hasSharedData, readSharedData, syncSharedData } = globalThis.SharedDataCodec;
const baseData = {
  schema: 2,
  featureName: "Base Project",
  branchName: "Base Branch",
  groups: [{
    uid: "group-1",
    dates: ["01/08/2026"],
    rows: [{
      uid: "row-1",
      activity: "Base activity",
      activityFormats: [],
      result: "Base result",
      resultFormats: [],
      pic: "Base PIC",
      picFormats: []
    }]
  }],
  makers: [{ uid: "maker-1", name: "Maker", role: "Role" }],
  comments: []
};

const seed = new Y.Doc();
syncSharedData(seed.getMap("form"), baseData);
const initialUpdate = Y.encodeStateAsUpdate(seed);
const initialVector = Y.encodeStateVector(seed);

const clientA = new Y.Doc();
const clientB = new Y.Doc();
Y.applyUpdate(clientA, initialUpdate);
Y.applyUpdate(clientB, initialUpdate);

const dataA = readSharedData(clientA.getMap("form"));
dataA.featureName = "Project A";
dataA.groups[0].rows[0].activity = "Activity A";
syncSharedData(clientA.getMap("form"), dataA);

const dataB = readSharedData(clientB.getMap("form"));
dataB.branchName = "Branch B";
dataB.groups[0].rows[0].result = "Result B";
syncSharedData(clientB.getMap("form"), dataB);

const updateA = Y.encodeStateAsUpdate(clientA, initialVector);
const updateB = Y.encodeStateAsUpdate(clientB, initialVector);
Y.applyUpdate(clientA, updateB);
Y.applyUpdate(clientB, updateA);

const mergedA = readSharedData(clientA.getMap("form"));
const mergedB = readSharedData(clientB.getMap("form"));
assert.deepEqual(mergedA, mergedB);
assert.equal(mergedA.featureName, "Project A");
assert.equal(mergedA.branchName, "Branch B");
assert.equal(mergedA.groups[0].rows[0].activity, "Activity A");
assert.equal(mergedA.groups[0].rows[0].result, "Result B");

const legacy = new Y.Doc().getMap("form");
legacy.set("data", baseData);
assert.equal(hasSharedData(legacy), true);
assert.equal(readSharedData(legacy).featureName, "Base Project");
syncSharedData(legacy, baseData);
assert.equal(legacy.has("data"), false);
assert.equal(readSharedData(legacy).groups[0].uid, "group-1");
