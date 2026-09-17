// Verifies per-field last-writer-wins merging: concurrent edits to different fields
// must both survive, and the same field must converge to one deterministic winner.
import assert from "node:assert/strict";
import * as Y from "yjs";

await import("../src/sharedData.js");

const {
  changedPaths,
  commitSharedChanges,
  mergeSharedData,
  hasLegacySnapshot,
  hasSharedNodes,
  maxSharedStamp,
  nodeValue,
  pendingNodePatch,
  readSharedData,
  reassertSharedNodes
} = globalThis.SharedDataCodec;

// Mirrors the client's commit path: diff the form against the baseline this editor last
// agreed on, then write only those paths.
function commitLikeClient(doc, baseline, data, timestamp, author) {
  const state = doc.getMap("form");
  const edits = changedPaths(baseline, data);
  const changes = commitSharedChanges(state, edits, { timestamp, author });
  return { changes, baseline: JSON.parse(JSON.stringify(data)) };
}

// The reported bug: user A types a project name, user B types a branch, and B's commit
// wipes A's work because B's DOM had not rendered A's value yet. With a baseline diff,
// B only writes what B actually changed.
{
  const room = new Y.Doc();
  const peerA = new Y.Doc();
  const peerB = new Y.Doc();
  const start = baseData();
  const startUpdate = (() => {
    commitSharedChanges(room.getMap("form"), changedPaths(null, start), { timestamp: 1000, author: "seed" });
    return Y.encodeStateAsUpdate(room);
  })();
  Y.applyUpdate(peerA, startUpdate);
  Y.applyUpdate(peerB, startUpdate);

  // Both peers start with the same agreed baseline.
  let baselineA = JSON.parse(JSON.stringify(start));
  let baselineB = JSON.parse(JSON.stringify(start));
  const aVector = Y.encodeStateVector(peerA);
  const bVector = Y.encodeStateVector(peerB);

  // A renames the project; B rebranches, without yet having seen A's edit.
  const aData = { ...start, featureName: "PROJECT DARI PEER A" };
  const bData = { ...start, branchName: "CABANG DARI PEER B" };
  const aResult = commitLikeClient(peerA, baselineA, aData, 2000, "peerA");
  baselineA = aResult.baseline;
  const bResult = commitLikeClient(peerB, baselineB, bData, 2000, "peerB");
  baselineB = bResult.baseline;

  // B must not have written anything for featureName: B never edited it.
  assert.ok(
    !bResult.changes.written.some((key) => key.includes("featureName")),
    "an unrendered remote field must not be echoed back as a write"
  );
  assert.deepEqual(bResult.changes.removed, [], "untouched paths must not be tombstoned");

  Y.applyUpdate(peerA, Y.encodeStateAsUpdate(peerB, bVector));
  Y.applyUpdate(peerB, Y.encodeStateAsUpdate(peerA, aVector));

  const mergedA = readSharedData(peerA.getMap("form"));
  const mergedB = readSharedData(peerB.getMap("form"));
  assert.equal(mergedB.featureName, "PROJECT DARI PEER A", "peer B keeps peer A's project name");
  assert.equal(mergedA.branchName, "CABANG DARI PEER B", "peer A keeps peer B's branch");
  assert.equal(mergedA.featureName, "PROJECT DARI PEER A");
  assert.equal(mergedB.branchName, "CABANG DARI PEER B");
}

// A stale tab must be silent: re-committing an unchanged snapshot writes nothing at all.
{
  const doc = new Y.Doc();
  const start = baseData();
  commitSharedChanges(doc.getMap("form"), changedPaths(null, start), { timestamp: 1000, author: "seed" });
  let baseline = JSON.parse(JSON.stringify(start));

  const edited = { ...start, featureName: "edited by someone else" };
  const other = commitLikeClient(doc, baseline, edited, 2000, "peer");
  assert.equal(other.changes.written.length, 1);

  // The stale tab still holds the old snapshot and commits again.
  const stale = commitLikeClient(doc, start, start, 3000, "stale-tab");
  assert.deepEqual(stale.changes.written, [], "unchanged snapshot writes nothing");
  assert.deepEqual(stale.changes.removed, [], "unchanged snapshot tombstone nothing");
  assert.equal(
    readSharedData(doc.getMap("form")).featureName,
    "edited by someone else",
    "stale tab cannot clobber a field it never edited"
  );
  baseline = other.baseline;
}

// A deliberate clear or row deletion is still a real edit and must propagate.
{
  const doc = new Y.Doc();
  const start = baseData();
  commitSharedChanges(doc.getMap("form"), changedPaths(null, start), { timestamp: 1000, author: "seed" });
  const baseline = JSON.parse(JSON.stringify(start));

  const cleared = commitLikeClient(doc, baseline, { ...start, featureName: "" }, 2000, "me");
  assert.ok(cleared.changes.written.some((key) => key.includes("featureName")), "clearing a field is a real edit");
  assert.equal(readSharedData(doc.getMap("form")).featureName, "");

  const withoutMakers = commitLikeClient(doc, cleared.baseline, { ...start, featureName: "", makers: [] }, 3000, "me");
  assert.ok(withoutMakers.changes.removed.some((key) => key.includes("maker-1")), "deleting a row propagates as a tombstone");
  assert.equal(readSharedData(doc.getMap("form")).makers.length, 0);
}

function baseData() {
  return {
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
}

// 1. Two peers edit different fields at the same logical time; both edits survive.
const seed = new Y.Doc();
mergeSharedData(seed.getMap("form"), baseData(), { timestamp: 1000, author: "seed" });
const seedUpdate = Y.encodeStateAsUpdate(seed);
const seedVector = Y.encodeStateVector(seed);

const peerA = new Y.Doc();
const peerB = new Y.Doc();
Y.applyUpdate(peerA, seedUpdate);
Y.applyUpdate(peerB, seedUpdate);

const dataA = readSharedData(peerA.getMap("form"));
dataA.featureName = "Project A";
mergeSharedData(peerA.getMap("form"), dataA, { timestamp: 2000, author: "peerA" });

const dataB = readSharedData(peerB.getMap("form"));
dataB.branchName = "Branch B";
mergeSharedData(peerB.getMap("form"), dataB, { timestamp: 2000, author: "peerB" });

Y.applyUpdate(peerA, Y.encodeStateAsUpdate(peerB, seedVector));
Y.applyUpdate(peerB, Y.encodeStateAsUpdate(peerA, seedVector));

const mergedA = readSharedData(peerA.getMap("form"));
const mergedB = readSharedData(peerB.getMap("form"));
assert.deepEqual(mergedA, mergedB, "peers converge after cross-applying updates");
assert.equal(mergedA.featureName, "Project A", "peer A field survives");
assert.equal(mergedA.branchName, "Branch B", "peer B field survives");

// 2. Same field, same logical stamp: the tie-break must pick the same winner on both sides.
const tieA = new Y.Doc();
const tieB = new Y.Doc();
Y.applyUpdate(tieA, seedUpdate);
Y.applyUpdate(tieB, seedUpdate);
mergeSharedData(tieA.getMap("form"), { ...baseData(), featureName: "AAA" }, { timestamp: 5000, author: "alpha" });
mergeSharedData(tieB.getMap("form"), { ...baseData(), featureName: "ZZZ" }, { timestamp: 5000, author: "zeta" });
Y.applyUpdate(tieA, Y.encodeStateAsUpdate(tieB, seedVector));
Y.applyUpdate(tieB, Y.encodeStateAsUpdate(tieA, seedVector));
assert.equal(
  readSharedData(tieA.getMap("form")).featureName,
  readSharedData(tieB.getMap("form")).featureName,
  "identical timestamps resolve to one deterministic winner"
);

// 3. This is the core anti-clobber property: a commit only writes the paths the local
// user actually changed. Re-committing an unchanged snapshot (what a stale tab used to
// send) touches nothing, so the other peer's fields are never overwritten.
const quietDoc = new Y.Doc();
mergeSharedData(quietDoc.getMap("form"), baseData(), { timestamp: 1000, author: "seed" });
mergeSharedData(quietDoc.getMap("form"), { ...baseData(), featureName: "edited remotely" }, { timestamp: 2000, author: "peer" });
const untouched = mergeSharedData(quietDoc.getMap("form"), readSharedData(quietDoc.getMap("form")), { timestamp: 3000, author: "stale-tab" });
assert.deepEqual(untouched.written, [], "an unchanged snapshot writes nothing");
assert.deepEqual(untouched.removed, [], "an unchanged snapshot removes nothing");
assert.equal(
  readSharedData(quietDoc.getMap("form")).featureName,
  "edited remotely",
  "stale tab cannot clobber a field it did not edit"
);

const oneField = mergeSharedData(quietDoc.getMap("form"), { ...readSharedData(quietDoc.getMap("form")), branchName: "Only Me" }, { timestamp: 4000, author: "me" });
assert.equal(oneField.written.length, 1, "only the changed path is written");
assert.ok(oneField.written[0].includes("\"branchName\""), "the changed path is branchName");

// 4. Deleted paths become tombstones instead of vanishing, so a stale peer cannot revive them.
const deleteDoc = new Y.Doc();
mergeSharedData(deleteDoc.getMap("form"), baseData(), { timestamp: 1000, author: "seed" });
const withoutMakers = { ...baseData(), makers: [] };
const deleteChanges = mergeSharedData(deleteDoc.getMap("form"), withoutMakers, { timestamp: 2000, author: "peerA" });
assert.ok(deleteChanges.removed.some((key) => key.includes("maker-1")), "removed maker paths are reported");
assert.equal(hasSharedNodes(deleteDoc.getMap("form")), true, "tombstones do not count as live data");
assert.equal(readSharedData(deleteDoc.getMap("form")).makers.length, 0);
assert.equal(hasLegacySnapshot(deleteDoc.getMap("form")), false);

// 5. Pending-node patch + reassert: newer local write wins, older local write yields.
const raceDoc = new Y.Doc();
mergeSharedData(raceDoc.getMap("form"), baseData(), { timestamp: 1000, author: "seed" });
const raceChanges = mergeSharedData(raceDoc.getMap("form"), { ...baseData(), featureName: "local" }, { timestamp: 7000, author: "me" });
const patch = pendingNodePatch(raceChanges, raceDoc.getMap("form"), 7000, "me");
const key = [...patch.keys()].find((entry) => entry.includes("\"featureName\""));
assert.ok(key, "featureName path is tracked as a pending node");

// Remote peer wrote a lower stamp: our pending edit must be re-asserted.
Y.applyUpdate(raceDoc, seedUpdate);
mergeSharedData(raceDoc.getMap("form"), { ...baseData(), featureName: "remote-old" }, { timestamp: 6000, author: "peer" });
const reassertResult = reassertSharedNodes(raceDoc.getMap("form"), patch, { author: "me" });
assert.ok(reassertResult.reasserted.includes(key), "newer local edit is re-asserted");
assert.equal(readSharedData(raceDoc.getMap("form")).featureName, "local");

// Remote peer wrote a higher stamp: we yield and drop the pending node.
const yieldDoc = new Y.Doc();
mergeSharedData(yieldDoc.getMap("form"), baseData(), { timestamp: 1000, author: "seed" });
const yieldChanges = mergeSharedData(yieldDoc.getMap("form"), { ...baseData(), featureName: "mine" }, { timestamp: 4000, author: "me" });
const yieldPatch = pendingNodePatch(yieldChanges, yieldDoc.getMap("form"), 4000, "me");
const yieldKey = [...yieldPatch.keys()].find((entry) => entry.includes("\"featureName\""));
mergeSharedData(yieldDoc.getMap("form"), { ...baseData(), featureName: "theirs" }, { timestamp: 8000, author: "peer" });
const yieldResult = reassertSharedNodes(yieldDoc.getMap("form"), yieldPatch, { author: "me" });
assert.ok(yieldResult.yielded.includes(yieldKey), "older local edit yields to the newer remote write");
assert.equal(readSharedData(yieldDoc.getMap("form")).featureName, "theirs");

// 6. Legacy raw snapshots still decode, and their stamp is 0 so any new edit replaces them.
const legacyDoc = new Y.Doc().getMap("form");
legacyDoc.set("data", baseData());
assert.equal(hasLegacySnapshot(legacyDoc), true, "legacy snapshot detected for migration");
assert.equal(readSharedData(legacyDoc).featureName, "Base Project");
assert.equal(maxSharedStamp(legacyDoc), 0);
mergeSharedData(legacyDoc, baseData(), { timestamp: 1, author: "me" });
legacyDoc.delete("data");
assert.equal(hasLegacySnapshot(legacyDoc), false);
assert.equal(hasSharedNodes(legacyDoc), true);

// 7. Meta values (updatedAt/updatedBy) are stamped nodes too, so nodeValue unwraps them.
const metaDoc = new Y.Doc().getMap("form");
metaDoc.set("updatedAt", { v: 12345, t: 12345, by: "me" });
assert.equal(nodeValue(metaDoc.get("updatedAt")), 12345, "meta values unwrap from their versioned node");
metaDoc.set("plain", 7);
assert.equal(nodeValue(metaDoc.get("plain")), 7, "unversioned values pass through");

console.log("sharedDataMerge: all merge/tombstone/convergence assertions passed");
