(function attachPiiMasking(root) {
  "use strict";

  const NAME_CORE_PATTERN = /^([\p{L}\p{N}]+)([^\p{L}\p{N}\s]*)$/u;
  const NAME_CHAR_PATTERN = /^[\p{L}\p{N}]+$/u;

  function takeEnd(chars, count) {
    return chars.slice(-count).join("");
  }

  function maskNameCore(value) {
    const chars = Array.from(String(value || ""));
    const length = chars.length;

    if (!length) return "";
    if (length === 1) return "*";
    if (length === 2) return `*${takeEnd(chars, 1)}`;
    if (length === 3) return `*${takeEnd(chars, 2)}`;
    if (length === 4) return `**${takeEnd(chars, 2)}`;
    if (length === 5) return `**${takeEnd(chars, 3)}`;
    if (length === 6) return `***${takeEnd(chars, 3)}`;
    if (length === 7) return `****${takeEnd(chars, 3)}`;

    return `${chars.slice(0, 4).join("")}${"*".repeat(Math.max(3, length - 6))}${takeEnd(chars, 2)}`;
  }

  function maskNameToken(token) {
    const value = String(token || "");
    const direct = value.match(NAME_CORE_PATTERN);

    if (direct) {
      const [, core, punctuation] = direct;
      return `${maskNameCore(core)}${punctuation}`;
    }

    return value
      .match(/[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu)
      ?.map((part) => (NAME_CHAR_PATTERN.test(part) ? maskNameCore(part) : part))
      .join("") || "";
  }

  function maskName(value) {
    if (value === null || value === undefined || value === "") return "";
    return String(value).replace(/\S+/g, (token) => maskNameToken(token));
  }

  function maskConfidentialToken(token) {
    const text = String(token || "");
    const length = text.length;
    if (length <= 1) return "*";
    if (length === 2) return `*${text.slice(-1)}`;
    if (length <= 4) return `${"*".repeat(length - 2)}${text.slice(-2)}`;
    return `${"*".repeat(length - 3)}${text.slice(-3)}`;
  }

  function maskConfidentialText(value) {
    return String(value || "").replace(/[A-Za-z0-9]+/g, (token) => maskConfidentialToken(token));
  }

  function hasMaskedToken(value) {
    return /(^|[\s([{])\*{1,}[A-Za-z0-9]{1,3}\b/.test(String(value || ""));
  }

  root.PiiMasking = Object.freeze({
    hasMaskedToken,
    maskConfidentialText,
    maskName,
    maskers: Object.freeze({
      confidential: maskConfidentialText,
      name: maskName
    })
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
