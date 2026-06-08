import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

assert.match(html, /function normalizeCommentReply/);
assert.match(html, /replies: normalizeCommentReplies\(comment\.replies\)/);
assert.match(html, /function canEditComment\(comment\)/);
assert.match(html, /function canEditReply\(reply\)/);
assert.match(html, /isSameCommentUserName\(collaboration\.user\.name/);
assert.match(html, /data-reply-root/);
assert.match(html, /data-edit-reply/);
assert.match(html, /data-delete-reply/);
assert.match(html, /Reply hanya bisa diedit oleh pembuatnya/);
assert.match(html, /Komentar hanya bisa diedit oleh pembuatnya/);
assert.match(html, /reply_created/);
assert.match(html, /reply_edited/);
assert.match(html, /reply_deleted/);
assert.match(html, /Log Comment/);
assert.doesNotMatch(html, /Audit comment/);
assert.doesNotMatch(html, /Audit reply/);
assert.doesNotMatch(html, /comment-owner-note/);
assert.doesNotMatch(html, /Edit\/hapus hanya untuk/);
assert.doesNotMatch(html, /is-collapsed/);
