import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BOOKING_HORIZON_DAYS,
  addDays,
  createBooking,
  fmtPrice,
  fmtTime,
  getSlots,
  todayMadrid,
  type BookingResult,
  type Slot,
} from "@/lib/padel";

const formatLongDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

const PadelBooking = () => {
  const today = todayMadrid();
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<BookingResult | null>(null);

  const loadSlots = async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      setSlots(await getSlots(d));
    } catch (e) {
      setError((e as Error).message);
      setSlots([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelected(null);
    loadSlots(date);
  }, [date]);

  const submit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createBooking(date, selected.start_time, name, email, phone);
      setConfirmation(result);
      setSelected(null);
      loadSlots(date);
    } catch (err) {
      setError((err as Error).message);
      loadSlots(date);
    } finally {
      setSubmitting(false);
    }
  };

  const ranges = Array.from(new Set(slots.map((s) => s.range_name)));

  if (confirmation) {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <h1 className="mb-2 text-2xl font-bold">¡Reserva confirmada!</h1>
        <p className="mb-1 capitalize">{formatLongDate(confirmation.booking_date)}</p>
        <p className="mb-1 text-lg font-semibold">
          {fmtTime(confirmation.start_time)} – {fmtTime(confirmation.end_time)}
        </p>
        <p className="mb-6 text-muted-foreground">Precio: {fmtPrice(confirmation.price_cents)}</p>
        <p className="mb-6 text-sm text-muted-foreground">
          Modo de pruebas: todavía no se cobra online. El pago con tarjeta se activará en el siguiente paso.
        </p>
        <Button onClick={() => setConfirmation(null)}>Hacer otra reserva</Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <h1 className="mb-1 text-2xl font-bold">Reserva tu pista de pádel</h1>
      <p className="mb-6 text-muted-foreground">Reservas de 1h15. Elige día y hora.</p>

      <label className="mb-6 block">
        <span className="mb-1 block text-sm font-medium">Día</span>
        <Input
          type="date"
          value={date}
          min={today}
          max={addDays(today, BOOKING_HORIZON_DAYS)}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </label>

      {error && <p className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Cargando horarios…</p>}
      {!loading && slots.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">No hay horarios para este día.</p>
      )}

      {ranges.map((range) => (
        <section key={range} className="mb-6">
          <h2 className="mb-2 font-semibold">{range}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {slots
              .filter((s) => s.range_name === range)
              .map((s) => {
                const isSelected = selected?.start_time === s.start_time;
                return (
                  <button
                    key={s.start_time}
                    type="button"
                    disabled={!s.available}
                    onClick={() => setSelected(s)}
                    className={`rounded-lg border p-3 text-left transition ${
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : s.available
                          ? "hover:border-primary"
                          : "cursor-not-allowed opacity-40 line-through"
                    }`}
                  >
                    <span className="block font-medium">
                      {fmtTime(s.start_time)} – {fmtTime(s.end_time)}
                    </span>
                    <span className="text-sm">{fmtPrice(s.price_cents)}</span>
                  </button>
                );
              })}
          </div>
        </section>
      ))}

      {selected && (
        <form onSubmit={submit} className="space-y-3 rounded-lg border p-4">
          <h2 className="font-semibold">
            Tus datos · {fmtTime(selected.start_time)} – {fmtTime(selected.end_time)} ·{" "}
            {fmtPrice(selected.price_cents)}
          </h2>
          <Input required placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            required
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input placeholder="Teléfono (opcional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Reservando…" : "Confirmar reserva"}
          </Button>
        </form>
      )}
    </main>
  );
};

export default PadelBooking;
