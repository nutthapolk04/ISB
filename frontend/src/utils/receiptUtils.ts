/**
 * Generate a unique receipt ID based on current date and time
 * Format: R-YYYYMMDD-HHMMSS
 * Example: R-20240115-143027
 */
export const generateReceiptId = (): string => {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `R-${year}${month}${day}-${hours}${minutes}${seconds}`;
};

/**
 * Generate a unique receipt ID with counter
 * Format: R-YYYYMMDD-XXX
 * This requires tracking the last counter for each day
 */
export const generateReceiptIdWithCounter = (lastReceiptId: string | null): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateString = `${year}${month}${day}`;

  // If no previous receipt or different date, start from 001
  if (!lastReceiptId || !lastReceiptId.includes(dateString)) {
    return `R-${dateString}-001`;
  }

  // Extract counter from last receipt ID (R-YYYYMMDD-XXX)
  const parts = lastReceiptId.split('-');
  if (parts.length === 3) {
    const lastCounter = parseInt(parts[2], 10);
    const newCounter = String(lastCounter + 1).padStart(3, '0');
    return `R-${dateString}-${newCounter}`;
  }

  // Fallback to 001 if parsing fails
  return `R-${dateString}-001`;
};

/**
 * Format date for receipt display
 * Format: YYYY-MM-DD HH:MM
 */
export const formatReceiptDate = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
};
