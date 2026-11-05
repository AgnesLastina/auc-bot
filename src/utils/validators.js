const moment = require('moment');

const validatePrice = (value) => {
  const pattern = /^\d+([.,]\d+)?[кk]?$/i;
  return pattern.test(value.trim());
};

const validateQuantity = (value, min = 1, max = 999) => {
  const num = parseInt(value);
  return !isNaN(num) && num >= min && num <= max;
};

const validateMutationSlots = (value) => {
  return ['0/4', '1/4', '2/4', '3/4', '4/4'].includes(value.trim());
};

const validateReserveDays = (value) => {
  const num = parseInt(value);
  return !isNaN(num) && num >= 1 && num <= 365;
};

const validateEndDate = (dateStr) => {
  const pattern = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/;
  const match = dateStr.match(pattern);
  
  if (!match) return false;
  
  const [_, day, month, year, hour, minute] = match;
  const date = moment(`${year}-${month}-${day} ${hour}:${minute}`, 'YYYY-MM-DD HH:mm');
  
  if (!date.isValid()) return false;
  
  const mskNow = moment().utcOffset(3);
  return date.isAfter(mskNow);
};

const parsePrice = (priceStr) => {
  if (!priceStr) return 0;
  
  let clean = String(priceStr).toLowerCase().trim().replace(/\s+/g, '');
  clean = clean.replace(/,/g, '.');

  const hasK = clean.endsWith('к') || clean.endsWith('k');
  if (hasK) {
    clean = clean.slice(0, -1);
  }

  let amount = parseFloat(clean);
  if (isNaN(amount)) return 0;

  if (hasK) {
    amount *= 1000;
  }

  return amount;
};

const formatPrice = (price) => {
  if (price >= 1000 && price % 1000 === 0) {
    return (price / 1000) + 'к';
  }
  return price.toString();
};

module.exports = {
  validatePrice,
  validateQuantity,
  validateMutationSlots,
  validateReserveDays,
  validateEndDate,
  parsePrice,
  formatPrice
};
