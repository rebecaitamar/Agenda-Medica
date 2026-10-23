/** Hora actual en milisegundos. Las páginas del panel se generan por solicitud, así que leer el reloj es intencional. */
export function nowMs() {
  return Date.now();
}
