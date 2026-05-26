// Generador de IDs locales para entidades creadas en el cliente.
// Antes habia ~11 declaraciones distintas (cada una con su prefijo) repetidas
// en stores y pages. Centralizado aca con la misma forma para todas.

/**
 * Genera un ID con prefijo + timestamp + random suffix.
 * Ejemplo: newId('mov') -> "mov-1716831234567-x4f".
 *
 * No es criptograficamente seguro — se usa para identificar registros
 * antes de que Supabase asigne IDs reales. La colision practica es
 * extremadamente improbable.
 */
export const newId = (prefix = 'id') =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
