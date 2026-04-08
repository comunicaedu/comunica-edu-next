/**
 * Valid Brazilian DDD codes
 */
const VALID_DDDS = [
  11, 12, 13, 14, 15, 16, 17, 18, 19, // SP
  21, 22, 24, // RJ
  27, 28, // ES
  31, 32, 33, 34, 35, 37, 38, // MG
  41, 42, 43, 44, 45, 46, // PR
  47, 48, 49, // SC
  51, 53, 54, 55, // RS
  61, // DF
  62, 64, // GO
  63, // TO
  65, 66, // MT
  67, // MS
  68, // AC
  69, // RO
  71, 73, 74, 75, 77, // BA
  79, // SE
  81, 82, 83, 84, 85, 86, 87, 88, 89, // NE
  91, 92, 93, 94, 95, 96, 97, 98, 99, // Norte/MA
];

export type PhoneType = "celular" | "fixo" | "internacional" | null;

export interface PhoneValidationResult {
  valid: boolean;
  type: PhoneType;
  error?: string;
}

/**
 * Formats a Brazilian phone number based on digit count
 */
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 13);
  if (digits.length === 0) return "";

  // International: starts with + or has more than 11 digits
  if (digits.length > 11) {
    // Format as +XX (XX) XXXXX-XXXX or similar
    return `+${digits.slice(0, digits.length - 11)} (${digits.slice(-11, -9)}) ${digits.slice(-9, -4)}-${digits.slice(-4)}`;
  }

  if (digits.length <= 2) return `(${digits}`;

  // 10 digits = landline: (XX) XXXX-XXXX
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;

  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  // 11 digits = mobile: (XX) XXXXX-XXXX
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

/**
 * Validates a Brazilian phone number
 */
export function isValidPhone(phone: string): PhoneValidationResult {
  const digits = phone.replace(/\D/g, "");

  if (digits.length === 0) return { valid: false, type: null };

  // International number (more than 11 digits)
  if (digits.length > 11 && digits.length <= 15) {
    return { valid: true, type: "internacional" };
  }

  if (digits.length > 15) {
    return { valid: false, type: "internacional", error: "Número internacional muito longo" };
  }

  if (digits.length < 10) return { valid: false, type: null, error: "Telefone incompleto" };

  const ddd = parseInt(digits.substring(0, 2));
  if (!VALID_DDDS.includes(ddd)) {
    return { valid: false, type: null, error: "DDD inválido" };
  }

  // Mobile: 11 digits, 3rd digit must be 9
  if (digits.length === 11) {
    if (digits[2] !== "9") {
      return { valid: false, type: "celular", error: "Celular deve começar com 9 após o DDD" };
    }
    return { valid: true, type: "celular" };
  }

  // Landline: 10 digits, 3rd digit between 2-5
  if (digits.length === 10) {
    const firstDigit = parseInt(digits[2]);
    if (firstDigit >= 2 && firstDigit <= 5) {
      return { valid: true, type: "fixo" };
    }
    // Could be a mobile missing the 9
    if (firstDigit >= 6) {
      return { valid: false, type: "celular", error: "Celular precisa ter 11 dígitos (com o 9)" };
    }
    return { valid: false, type: "fixo", error: "Telefone fixo inválido" };
  }

  return { valid: false, type: null, error: "Telefone inválido" };
}
