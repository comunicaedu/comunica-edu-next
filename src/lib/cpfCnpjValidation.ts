/**
 * Validates a CPF number using the mathematical algorithm
 */
export function isValidCPF(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return false;

  // Check for known invalid patterns (all same digits)
  if (/^(\d)\1{10}$/.test(digits)) return false;

  // Validate first check digit
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits[i]) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== parseInt(digits[9])) return false;

  // Validate second check digit
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(digits[i]) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== parseInt(digits[10])) return false;

  return true;
}

/**
 * Validates a CNPJ number using the mathematical algorithm
 */
export function isValidCNPJ(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return false;

  // Check for known invalid patterns
  if (/^(\d)\1{13}$/.test(digits)) return false;

  // Validate first check digit
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(digits[i]) * weights1[i];
  }
  let remainder = sum % 11;
  const firstDigit = remainder < 2 ? 0 : 11 - remainder;
  if (parseInt(digits[12]) !== firstDigit) return false;

  // Validate second check digit
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(digits[i]) * weights2[i];
  }
  remainder = sum % 11;
  const secondDigit = remainder < 2 ? 0 : 11 - remainder;
  if (parseInt(digits[13]) !== secondDigit) return false;

  return true;
}

/**
 * Validates CPF or CNPJ based on digit length
 */
export function isValidDocument(value: string): { valid: boolean; type: "cpf" | "cnpj" | null; error?: string } {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 0) return { valid: false, type: null };

  if (digits.length <= 11) {
    if (digits.length < 11) return { valid: false, type: "cpf", error: "CPF incompleto" };
    if (!isValidCPF(digits)) return { valid: false, type: "cpf", error: "Documento Inválido" };
    return { valid: true, type: "cpf" };
  }

  if (digits.length < 14) return { valid: false, type: "cnpj", error: "CNPJ incompleto" };
  if (!isValidCNPJ(digits)) return { valid: false, type: "cnpj", error: "Documento Inválido" };
  return { valid: true, type: "cnpj" };
}
