import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BOOKING_HORIZON_DAYS,
  addDays,
  createBooking,
  fmtPrice,
  fmtTime,
  getSlots,
  isMember,
  padelDb,
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
  const [confirmedAsMember, setConfirmedAsMember] = useState(false);

  // Sesión (opcional) y condición de socio
  const [session, setSession] = useState<Session | null>(null);
  const [member, setMember] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    padelDb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = padelDb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setMember(false);
      return;
    }
    setEmail(session.user.email ?? "");
    isMember().then(setMember);
  }, [session]);

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

  const handleAuth = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthMsg(null);
    if (authMode === "login") {
      const { error: err } = await padelDb.auth.signInWithPassword({ email: authEmail, password: authPassword });
      if (err) setAuthMsg(err.message);
      else {
        setShowAuth(false);
        setAuthPassword("");
      }
    } else {
      const { data, error: err } = await padelDb.auth.signUp({
        email: authEmail,
        password: authPassword,
        options: { emailRedirectTo: `${window.location.origin}/padel` },
      });
      if (err) setAuthMsg(err.message);
      else if (data.session) {
        setShowAuth(false);
        setAuthPassword("");
      } else {
        setAuthMsg("Te hemos enviado un email para confirmar tu cuenta. Después de confirmarlo, inicia sesión.");
      }
    }
    setAuthBusy(false);
  };

  const logout = async () => {
    await padelDb.auth.signOut();
    setEmail("");
  };

  const submit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createBooking(date, selected.start_time, name, email, phone);
      setConfirmedAsMember(member);
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
        {confirmedAsMember ? (
          <p className="mb-6 text-sm text-muted-foreground">Reserva de socio: no tienes nada que pagar.</p>
        ) : (
          <>
            <p className="mb-6 text-muted-foreground">Precio: {fmtPrice(confirmation.price_cents)}</p>
            <p className="mb-6 text-sm text-muted-foreground">
              Modo de pruebas: todavía no se cobra online. El pago con tarjeta se activará más adelante.
            </p>
          </>
        )}
        <Button onClick={() => setConfirmation(null)}>Hacer otra reserva</Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <h1 className="mb-1 text-2xl font-bold">Reserva tu pista de pádel</h1>
      <p className="mb-6 text-muted-foreground">Reservas de 1h15. Elige día y hora.</p>

      <div className="mb-6 rounded-lg border p-3 text-sm">
        {session ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Sesión iniciada como <strong>{session.user.email}</strong>
              {member ? " · Socio" : ""}
            </span>
            <Button size="sm" variant="outline" onClick={logout}>
              Cerrar sesión
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>¿Eres socio? Inicia sesión para reservar sin pagar.</span>
              <Button size="sm" variant="outline" onClick={() => setShowAuth(!showAuth)}>
                {showAuth ? "Cerrar" : "Iniciar sesión / Crear cuenta"}
              </Button>
            </div>
            {showAuth && (
              <form onSubmit={handleAuth} className="mt-3 space-y-2">
                <Input
                  required
                  type="email"
                  placeholder="Email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                />
                <Input
                  required
                  type="password"
                  minLength={6}
                  placeholder="Contraseña (mínimo 6 caracteres)"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                />
                {authMsg && <p className="text-sm text-muted-foreground">{authMsg}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" size="sm" disabled={authBusy}>
                    {authMode === "login" ? "Entrar" : "Crear cuenta"}
                  </Button>
                  <button
                    type="button"
                    className="text-sm underline"
                    onClick={() => {
                      setAuthMode(authMode === "login" ? "signup" : "login");
                      setAuthMsg(null);
                    }}
                  >
                    {authMode === "login" ? "No tengo cuenta" : "Ya tengo cuenta"}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>

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
                    {!member && <span className="text-sm">{fmtPrice(s.price_cents)}</span>}
                  </button>
                );
              })}
          </div>
        </section>
      ))}

      {selected && (
        <form onSubmit={submit} className="space-y-3 rounded-lg border p-4">
          <h2 className="font-semibold">
            Tus datos · {fmtTime(selected.start_time)} – {fmtTime(selected.end_time)}
            {!member && ` · ${fmtPrice(selected.price_cents)}`}
          </h2>
          <Input required placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            required
            type="email"
            placeholder="Email"
            value={email}
            readOnly={!!session}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input placeholder="Teléfono (opcional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Reservando…" : member ? "Reservar" : "Pagar y reservar"}
          </Button>
        </form>
      )}
    </main>
  );
};

export default PadelBooking;
