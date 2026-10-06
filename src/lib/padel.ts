import { createClient } from "@supabase/supabase-js";

// Cliente de Supabase propio del módulo de pádel (proyecto de Santos Sports Bar).
// Es independiente del cliente de src/integrations/supabase, que apunta al proyecto de la plantilla.
// La clave publishable es pública por diseño; se puede sobrescribir con variables de entorno.
const PADEL_URL =
  import.meta.env.VITE_PADEL_SUPABASE_URL ?? "https://ymmwgjohczrdrdsdlghj.supabase.co";
const PADEL_KEY =
  import.meta.env.VITE_PADEL_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_CGDRdm4my3Aq5x6NWadYBw_SQ-9xbae";

export const padelDb = createClient(PADEL_URL, PADEL_KEY, {
  auth: { storage: localStorage, persistSession: true, autoRefreshToken: true, storageKey: "padel-auth" },
});

export const PADEL_TENANT = "santos-sports-bar";
export const PADEL_TZ = "Europe/Madrid";
export const BOOKING_HORIZON_DAYS = 30;
// Duración de cada reserva en minutos (1h15). Debe coincidir con padel_settings.slot_minutes.
export const SLOT_MINUTES = 75;

export interface Slot {
  start_time: string;
  end_time: string;
  price_cents: number;
  range_name: string;
  available: boolean;
}

export interface BookingResult {
  booking_id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  price_cents: number;
}

export const fmtTime = (t: string) => t.slice(0, 5);
export const fmtPrice = (cents: number) =>
  (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

// Fecha de hoy (YYYY-MM-DD) en la zona horaria del bar
export const todayMadrid = () => new Date().toLocaleDateString("sv-SE", { timeZone: PADEL_TZ });

export const addDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("sv-SE");
};

export async function getSlots(date: string): Promise<Slot[]> {
  const { data, error } = await padelDb.rpc("padel_available_slots", {
    p_tenant: PADEL_TENANT,
    p_date: date,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Slot[];
}

// Si hay sesión iniciada, el servidor usa el email confirmado de la cuenta y detecta si es socio
// (los socios reservan con precio 0 y pago "member").
export async function createBooking(
  date: string,
  start: string,
  name: string,
  email: string,
  phone: string,
): Promise<BookingResult> {
  const { data, error } = await padelDb.rpc("padel_create_booking", {
    p_tenant: PADEL_TENANT,
    p_date: date,
    p_start: start,
    p_name: name,
    p_email: email,
    p_phone: phone || null,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row as BookingResult;
}

// ¿La sesión actual pertenece a un socio activo? (sin sesión devuelve false)
export async function isMember(): Promise<boolean> {
  const { data, error } = await padelDb.rpc("padel_is_member", { p_tenant: PADEL_TENANT });
  if (error) return false;
  return data === true;
}

// Solo administradores. Conserva el precio y el estado de pago de la reserva original.
export async function rescheduleBooking(bookingId: string, date: string, start: string): Promise<void> {
  const { error } = await padelDb.rpc("padel_reschedule_booking", {
    p_booking: bookingId,
    p_date: date,
    p_start: start,
  });
  if (error) throw new Error(error.message);
}
