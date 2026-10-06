import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PADEL_TENANT, fmtPrice, fmtTime, padelDb, todayMadrid } from "@/lib/padel";

interface Booking {
  id: string;
  start_time: string;
  end_time: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  price_cents: number;
  status: string;
  payment_status: string;
}
interface Range {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  price_cents: number;
}
interface Block {
  id: string;
  block_date: string;
  start_time: string;
  end_time: string;
  reason: string | null;
}
interface Closure {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  reason: string | null;
}

const WEEKDAYS = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const sectionCls = "mb-8 rounded-lg border p-4";
const selectCls = "h-10 rounded-md border bg-background px-3 text-sm";

const PadelAdmin = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [date, setDate] = useState(todayMadrid());
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [ranges, setRanges] = useState<Range[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [closures, setClosures] = useState<Closure[]>([]);

  const [newBlock, setNewBlock] = useState({ date: todayMadrid(), start: "17:00", end: "18:15", reason: "" });
  const [newClosure, setNewClosure] = useState({ weekday: 2, start: "17:00", end: "19:00", reason: "" });

  useEffect(() => {
    padelDb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = padelDb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setIsAdmin(false);
      return;
    }
    padelDb
      .from("padel_admins")
      .select("user_id")
      .eq("tenant_slug", PADEL_TENANT)
      .then(({ data }) => setIsAdmin(!!data && data.length > 0));
  }, [session]);

  const loadBookings = useCallback(async () => {
    const { data, error } = await padelDb
      .from("padel_bookings")
      .select("*")
      .eq("tenant_slug", PADEL_TENANT)
      .eq("booking_date", date)
      .order("start_time");
    if (error) toast.error(error.message);
    else setBookings((data ?? []) as Booking[]);
  }, [date]);

  const loadConfig = useCallback(async () => {
    const [r, b, c] = await Promise.all([
      padelDb.from("padel_price_ranges").select("*").eq("tenant_slug", PADEL_TENANT).order("start_time"),
      padelDb
        .from("padel_blocks")
        .select("*")
        .eq("tenant_slug", PADEL_TENANT)
        .gte("block_date", todayMadrid())
        .order("block_date")
        .order("start_time"),
      padelDb.from("padel_weekly_closures").select("*").eq("tenant_slug", PADEL_TENANT).order("weekday").order("start_time"),
    ]);
    setRanges((r.data ?? []) as Range[]);
    setBlocks((b.data ?? []) as Block[]);
    setClosures((c.data ?? []) as Closure[]);
  }, []);

  useEffect(() => {
    if (isAdmin) loadBookings();
  }, [isAdmin, loadBookings]);
  useEffect(() => {
    if (isAdmin) loadConfig();
  }, [isAdmin, loadConfig]);

  const login = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    const { error } = await padelDb.auth.signInWithPassword({ email, password });
    if (error) toast.error(error.message);
  };

  const run = async (action: PromiseLike<{ error: { message: string } | null }>, ok: string, after: () => void) => {
    const { error } = await action;
    if (error) toast.error(error.message);
    else {
      toast.success(ok);
      after();
    }
  };

  const cancelBooking = (b: Booking) => {
    if (!window.confirm(`¿Cancelar la reserva de ${b.customer_name}? (El reembolso automático llegará con el pago online.)`)) return;
    run(padelDb.from("padel_bookings").update({ status: "cancelled" }).eq("id", b.id), "Reserva cancelada", loadBookings);
  };

  const saveRange = (r: Range) =>
    run(
      padelDb
        .from("padel_price_ranges")
        .update({
          name: r.name,
          start_time: r.start_time.slice(0, 5),
          end_time: r.end_time.slice(0, 5),
          price_cents: r.price_cents,
        })
        .eq("id", r.id),
      "Franja guardada",
      loadConfig,
    );

  const addBlock = () =>
    run(
      padelDb.from("padel_blocks").insert({
        tenant_slug: PADEL_TENANT,
        block_date: newBlock.date,
        start_time: newBlock.start,
        end_time: newBlock.end,
        reason: newBlock.reason || null,
      }),
      "Bloqueo añadido",
      loadConfig,
    );

  const addClosure = () =>
    run(
      padelDb.from("padel_weekly_closures").insert({
        tenant_slug: PADEL_TENANT,
        weekday: newClosure.weekday,
        start_time: newClosure.start,
        end_time: newClosure.end,
        reason: newClosure.reason || null,
      }),
      "Cierre semanal añadido",
      loadConfig,
    );

  if (!ready) return <p className="p-6">Cargando…</p>;

  if (!session) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <h1 className="mb-4 text-2xl font-bold">Administración de la pista</h1>
        <form onSubmit={login} className="space-y-3">
          <Input required type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input
            required
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" className="w-full">
            Entrar
          </Button>
        </form>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-sm p-6">
        <p className="mb-4">Esta cuenta ({session.user.email}) no tiene permisos de administración de la pista.</p>
        <Button variant="outline" onClick={() => padelDb.auth.signOut()}>
          Cerrar sesión
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Administración de la pista</h1>
        <Button variant="outline" onClick={() => padelDb.auth.signOut()}>
          Cerrar sesión
        </Button>
      </div>

      <section className={sectionCls}>
        <h2 className="mb-3 font-semibold">Reservas del día</h2>
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="mb-3 max-w-xs" />
        {bookings.length === 0 && <p className="text-sm text-muted-foreground">Sin reservas.</p>}
        <ul className="space-y-2">
          {bookings.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
              <div className={b.status === "cancelled" ? "opacity-50 line-through" : ""}>
                <strong>
                  {fmtTime(b.start_time)} – {fmtTime(b.end_time)}
                </strong>{" "}
                · {b.customer_name} · {b.customer_email}
                {b.customer_phone ? ` · ${b.customer_phone}` : ""} · {fmtPrice(b.price_cents)} ({b.payment_status})
              </div>
              {b.status !== "cancelled" && (
                <Button size="sm" variant="outline" onClick={() => cancelBooking(b)}>
                  Cancelar
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className={sectionCls}>
        <h2 className="mb-3 font-semibold">Franjas y precios</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Cada franja se divide en reservas de 1h15. Cambia horario o precio y guarda.
        </p>
        <div className="space-y-2">
          {ranges.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2">
              <Input
                className="w-28"
                value={r.name}
                onChange={(e) => setRanges(ranges.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)))}
              />
              <Input
                type="time"
                className="w-28"
                value={r.start_time.slice(0, 5)}
                onChange={(e) => setRanges(ranges.map((x) => (x.id === r.id ? { ...x, start_time: e.target.value } : x)))}
              />
              <Input
                type="time"
                className="w-28"
                value={r.end_time.slice(0, 5)}
                onChange={(e) => setRanges(ranges.map((x) => (x.id === r.id ? { ...x, end_time: e.target.value } : x)))}
              />
              <Input
                type="number"
                step="0.5"
                min="0"
                className="w-24"
                value={r.price_cents / 100}
                onChange={(e) =>
                  setRanges(
                    ranges.map((x) =>
                      x.id === r.id ? { ...x, price_cents: Math.round(parseFloat(e.target.value || "0") * 100) } : x,
                    ),
                  )
                }
              />
              <span className="text-sm">€</span>
              <Button size="sm" onClick={() => saveRange(r)}>
                Guardar
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className={sectionCls}>
        <h2 className="mb-3 font-semibold">Bloquear horas en un día concreto</h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input type="date" className="w-40" value={newBlock.date} onChange={(e) => setNewBlock({ ...newBlock, date: e.target.value })} />
          <Input type="time" className="w-28" value={newBlock.start} onChange={(e) => setNewBlock({ ...newBlock, start: e.target.value })} />
          <Input type="time" className="w-28" value={newBlock.end} onChange={(e) => setNewBlock({ ...newBlock, end: e.target.value })} />
          <Input placeholder="Motivo" className="w-40" value={newBlock.reason} onChange={(e) => setNewBlock({ ...newBlock, reason: e.target.value })} />
          <Button size="sm" onClick={addBlock}>
            Bloquear
          </Button>
        </div>
        <ul className="space-y-1 text-sm">
          {blocks.map((b) => (
            <li key={b.id} className="flex items-center justify-between rounded-md border p-2">
              <span>
                {b.block_date} · {fmtTime(b.start_time)} – {fmtTime(b.end_time)}
                {b.reason ? ` · ${b.reason}` : ""}
              </span>
              <Button size="sm" variant="outline" onClick={() => run(padelDb.from("padel_blocks").delete().eq("id", b.id), "Bloqueo eliminado", loadConfig)}>
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section className={sectionCls}>
        <h2 className="mb-3 font-semibold">Horas no disponibles cada semana</h2>
        <p className="mb-3 text-sm text-muted-foreground">Por ejemplo: todos los martes de 17:00 a 19:00 hay clase.</p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select className={selectCls} value={newClosure.weekday} onChange={(e) => setNewClosure({ ...newClosure, weekday: Number(e.target.value) })}>
            {WEEKDAYS.slice(1).map((d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ))}
          </select>
          <Input type="time" className="w-28" value={newClosure.start} onChange={(e) => setNewClosure({ ...newClosure, start: e.target.value })} />
          <Input type="time" className="w-28" value={newClosure.end} onChange={(e) => setNewClosure({ ...newClosure, end: e.target.value })} />
          <Input placeholder="Motivo" className="w-40" value={newClosure.reason} onChange={(e) => setNewClosure({ ...newClosure, reason: e.target.value })} />
          <Button size="sm" onClick={addClosure}>
            Añadir
          </Button>
        </div>
        <ul className="space-y-1 text-sm">
          {closures.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-md border p-2">
              <span>
                {WEEKDAYS[c.weekday]} · {fmtTime(c.start_time)} – {fmtTime(c.end_time)}
                {c.reason ? ` · ${c.reason}` : ""}
              </span>
              <Button size="sm" variant="outline" onClick={() => run(padelDb.from("padel_weekly_closures").delete().eq("id", c.id), "Cierre eliminado", loadConfig)}>
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
};

export default PadelAdmin;
