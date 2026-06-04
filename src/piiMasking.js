(function attachPiiMasking(root) {
  "use strict";

  const MASKING_TYPES = [
    ["name", "Nama"],
    ["titledName", "Nama dengan gelar"],
    ["date", "Tanggal"],
    ["identityNumber", "Nomor Identitas Nasabah"],
    ["passport", "Nomor Paspor"],
    ["phone", "No. Handphone / Telepon"],
    ["address", "Alamat"],
    ["email", "Alamat Email"],
    ["npwpNitku", "NPWP / NITKU"],
    ["fatcaCrs", "Informasi FATCA CRS / KITAS"],
    ["all", "Masking semua digit/karakter"],
    ["riskCategory", "Kategori Risiko Nasabah"],
    ["bcaUserId", "BCA ID / User ID"],
    ["balance", "Informasi Saldo"],
    ["accountNumber", "Nomor rekening"],
    ["cardNumber", "Nomor kartu"],
    ["cardExpiry", "Tanggal expired kartu"],
    ["cvv", "CVV"],
    ["customerNumber", "Customer Number"],
    ["serialNumber", "Serial Number"]
  ];

  function repeatMask(count) {
    return "*".repeat(Math.max(0, count));
  }

  function maskCore(value, first, last) {
    const chars = Array.from(String(value || ""));
    if (chars.length <= first + last) return repeatMask(chars.length);
    return `${chars.slice(0, first).join("")}${repeatMask(chars.length - first - last)}${last ? chars.slice(-last).join("") : ""}`;
  }

  function maskNameCore(value) {
    const chars = Array.from(String(value || ""));
    const length = chars.length;
    if (!length) return "";
    if (length === 1) return "*";
    if (length === 2) return `*${chars.slice(-1).join("")}`;
    if (length === 3) return `*${chars.slice(-2).join("")}`;
    if (length === 4) return `**${chars.slice(-2).join("")}`;
    if (length === 5) return `**${chars.slice(-3).join("")}`;
    if (length === 6) return `***${chars.slice(-3).join("")}`;
    if (length === 7) return `****${chars.slice(-3).join("")}`;
    return `${chars.slice(0, 4).join("")}${repeatMask(Math.max(3, length - 6))}${chars.slice(-2).join("")}`;
  }

  function maskName(value) {
    return String(value || "").replace(/[\p{L}\p{N}]+/gu, (token) => maskNameCore(token));
  }

  function maskDateAllDigits(value) {
    return String(value || "").replace(/\d/g, "*");
  }

  function maskAll(value) {
    return String(value || "").replace(/[A-Za-z0-9]/g, "*");
  }

  function maskDigitsKeep(value, first, last) {
    const text = String(value || "");
    const digits = text.replace(/\D/g, "");
    const masked = maskCore(digits, first, last);
    let cursor = 0;
    return text.replace(/\d/g, () => masked[cursor++] || "*");
  }

  function maskLast(value, count) {
    const text = String(value || "");
    const chars = Array.from(text);
    return chars.map((char, index) => {
      if (!/[A-Za-z0-9]/.test(char)) return char;
      const tail = chars.slice(index).filter((item) => /[A-Za-z0-9]/.test(item)).length;
      return tail <= count ? char : "*";
    }).join("");
  }

  function maskPhone(value) {
    const text = String(value || "");
    const plus = text.trim().startsWith("+");
    const digits = text.replace(/\D/g, "");
    const first = plus ? Math.min(6, digits.length) : 4;
    return maskDigitsKeep(text, first, 2);
  }

  function maskAddress(value) {
    return String(value || "")
      .replace(/\d/g, "*")
      .replace(/\b[IVXLCDM]{1,8}\b/gi, (token) => repeatMask(token.length));
  }

  function maskEmail(value) {
    return String(value || "").replace(/([^\s@]+)@([^\s@]+)/g, (_, local, domain) => `${maskNameCore(local)}@${domain}`);
  }

  function maskBcaUserId(value) {
    const raw = String(value || "");
    const token = raw.replace(/\s/g, "");
    const length = token.length;
    let masked = "";
    if (length <= 6) masked = maskCore(token, 2, 1);
    else if (length === 7) masked = maskCore(token, 3, 2);
    else masked = maskCore(token, 4, 2);
    let cursor = 0;
    return raw.replace(/\S/g, () => masked[cursor++] || "*");
  }

  function maskBalance(value) {
    return String(value || "").replace(/\d[\d.,]*/g, (match) => {
      const decimalMatch = match.match(/([.,]\d{1,2})$/);
      const decimal = decimalMatch ? decimalMatch[1] : "";
      const amount = decimal ? match.slice(0, -decimal.length) : match;
      const digits = amount.replace(/\D/g, "");
      if (digits.length <= 3) return match;
      const maskedDigits = `${repeatMask(digits.length - 3)}${digits.slice(-3)}`;
      let cursor = 0;
      const maskedAmount = amount.replace(/\d/g, () => maskedDigits[cursor++] || "*");
      return `${maskedAmount}${decimal}`;
    });
  }

  function maskAccountNumber(value) {
    const raw = String(value || "");
    const digits = raw.replace(/\D/g, "");
    const length = digits.length;
    let first = 3;
    let last = 2;
    if (length === 4) [first, last] = [1, 1];
    else if (length === 5) [first, last] = [2, 1];
    else if (length === 6) [first, last] = [2, 1];
    else if (length === 7) [first, last] = [2, 2];
    return maskDigitsKeep(raw, first, last);
  }

  function groupDigits(value) {
    return value.replace(/(.{4})/g, "$1 ").trim();
  }

  function maskCardNumber(value, policy = "default") {
    const digits = String(value || "").replace(/\D/g, "");
    if (!digits) return "";
    if (policy === "pciDss") return `${groupDigits(maskCore(digits, 6, 4))} (PCI DSS)`;
    if (policy === "visa") return `${groupDigits(`${repeatMask(Math.max(0, digits.length - 4))}${digits.slice(-4)}`)} (Visa)`;
    return groupDigits(maskCore(digits, 4, 2));
  }

  function maskCustomerNumber(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (!digits) return "";
    const leading = digits.match(/^0*/)?.[0] || "";
    const significant = digits.slice(leading.length) || "0";
    const length = significant.length;
    let first = 2;
    let last = 2;
    if (length === 4) [first, last] = [1, 1];
    else if (length === 5) [first, last] = [2, 1];
    else if (length === 6) [first, last] = [2, 1];
    return groupDigits(`${leading}${maskCore(significant, first, last)}`);
  }

  function maskTypeLabel(type) {
    return MASKING_TYPES.find(([value]) => value === type)?.[1] || "";
  }

  function luhnValid(digits) {
    if (!/^\d{12,19}$/.test(digits)) return false;
    let sum = 0;
    let alternate = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let value = Number(digits[index]);
      if (alternate) {
        value *= 2;
        if (value > 9) value -= 9;
      }
      sum += value;
      alternate = !alternate;
    }
    return sum % 10 === 0;
  }

  function maskSuggestion(type, confidence, reason, options = {}) {
    return {
      type,
      label: maskTypeLabel(type),
      confidence,
      reason,
      ...options
    };
  }

  function inferMaskType(value) {
    const text = String(value || "").trim();
    const digits = text.replace(/\D/g, "");
    const letters = text.replace(/[^\p{L}]/gu, "");
    if (!text) return maskSuggestion("", "", "");
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return maskSuggestion("email", "tinggi", "format email");
    if (/^(Rp\.?|IDR)\s*[\d.,]+/i.test(text) || /^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.test(text)) {
      return maskSuggestion("balance", "tinggi", "format nominal");
    }
    if (/^\d{2}[/-]\d{2}$/.test(text)) return maskSuggestion("cardExpiry", "sedang", "format MM/YY");
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(text)) return maskSuggestion("date", "tinggi", "format tanggal");
    if (/^\+?\d[\d\s-]{7,}$/.test(text) && /^(0|62|\+62)/.test(text.replace(/\s/g, "")) && digits.length >= 8 && digits.length <= 15) {
      return maskSuggestion("phone", "tinggi", "format telepon");
    }
    if (digits.length >= 13 && digits.length <= 19 && (luhnValid(digits) || /^\d{4}([\s-]?\d{4}){2,4}$/.test(text))) {
      return maskSuggestion("cardNumber", luhnValid(digits) ? "tinggi" : "sedang", "format nomor kartu", { cardPolicy: "default" });
    }
    if (/^\d{3,4}$/.test(text)) return maskSuggestion("cvv", "rendah", "3-4 digit");
    if (/^\d{16}$/.test(digits) && digits === text) return maskSuggestion("identityNumber", "sedang", "16 digit");
    if (/^\d{22}$/.test(digits) && digits === text) return maskSuggestion("npwpNitku", "sedang", "22 digit");
    if (/^[A-Z]\s?\d{6,8}$/i.test(text)) return maskSuggestion("passport", "sedang", "format paspor");
    if (/^[A-Z]{2,}[A-Z0-9]{4,}$/i.test(text) && !/\s/.test(text)) return maskSuggestion("bcaUserId", "sedang", "format user id");
    if (/\b(Jl\.?|Jalan|Blok|No\.?)\b/i.test(text)) return maskSuggestion("address", "sedang", "format alamat");
    if (/\b(Dr|Ir|Prof|Hj|H|S\.|M\.)\.?/i.test(text) && letters.length >= 3) return maskSuggestion("titledName", "sedang", "nama bergelar");
    if (/^[\p{L}.'\s-]+$/u.test(text) && letters.length >= 2) return maskSuggestion("name", "sedang", "format nama");
    return maskSuggestion("all", "rendah", "fallback");
  }

  function maskByType(type, value, options = {}) {
    const maskers = {
      name: maskName,
      titledName: maskName,
      date: maskDateAllDigits,
      identityNumber: (text) => maskDigitsKeep(text, 4, 2),
      passport: (text) => maskLast(text, 3),
      phone: maskPhone,
      address: maskAddress,
      email: maskEmail,
      npwpNitku: (text) => maskDigitsKeep(text, 4, 2),
      fatcaCrs: (text) => maskLast(text, 3),
      all: maskAll,
      riskCategory: maskAll,
      bcaUserId: maskBcaUserId,
      balance: maskBalance,
      accountNumber: maskAccountNumber,
      cardNumber: (text, maskOptions = {}) => maskCardNumber(text, maskOptions.cardPolicy),
      cardExpiry: maskDateAllDigits,
      cvv: maskAll,
      customerNumber: maskCustomerNumber,
      serialNumber: (text) => maskLast(text, 3)
    };
    return (maskers[type] || maskAll)(value, options);
  }

  function hasMaskedToken(value) {
    return /(^|[\s([{])\*{1,}[A-Za-z0-9]{1,3}\b/.test(String(value || ""));
  }

  root.PiiMasking = Object.freeze({
    MASKING_TYPES,
    hasMaskedToken,
    inferMaskType,
    maskByType,
    maskName,
    maskers: Object.freeze({
      name: maskName,
      titledName: maskName,
      date: maskDateAllDigits,
      identityNumber: (text) => maskDigitsKeep(text, 4, 2),
      passport: (text) => maskLast(text, 3),
      phone: maskPhone,
      address: maskAddress,
      email: maskEmail,
      npwpNitku: (text) => maskDigitsKeep(text, 4, 2),
      fatcaCrs: (text) => maskLast(text, 3),
      all: maskAll,
      riskCategory: maskAll,
      bcaUserId: maskBcaUserId,
      balance: maskBalance,
      accountNumber: maskAccountNumber,
      cardNumber: (text, options = {}) => maskCardNumber(text, options.cardPolicy),
      cardExpiry: maskDateAllDigits,
      cvv: maskAll,
      customerNumber: maskCustomerNumber,
      serialNumber: (text) => maskLast(text, 3)
    })
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
