import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PADEL_TENANT,
  SLOT_MINUTES,
  fmtPrice,
  fmtTime,
  getSlots,
  padelDb,
  rescheduleBooking,
  todayMadrid,
  type Slot,
} from "@/lib/padel";

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
interface Member {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
}

const WEEKDAYS = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const sectionCls = "mb-8 rounded-lg border p-4";
const selectCls = "h-10 rounded-md border bg-background px-3 text-sm";

const minutesOf = (t: string) => {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};

// Texto informativo: cuántas reservas de 1h15 caben en una franja
const describeRange = (start: string, end: string) => {
  if (!start || !end) return "";
  const total = minutesOf(end) - minutesOf(start);
  if (!(total > 0)) return "";
  const n = Math.floor(total / SLOT_MINUTES);
  const rest = total - n * SLOT_MINUTES;
  return `${n} reserva${n === 1 ? "" : "s"} de 1h15${rest ? ` · sobran ${rest} min sin usar` : ""}`;
};

// Devuelve un mensaje de error si la franja no es válida, o null si está bien
const rangeProblem = (start: string, end: string, others: Range[]): string | null => {
  if (!start || !end) return "Indica la hora de inicio y la de fin";
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (e <= s) return "La hora de fin debe ser posterior a la de inicio";
  if (e - s < SLOT_MINUTES) return "La franja es más corta que una reserva de 1h15";
  if (others.some((o) => s < minutesOf(o.end_time) && e > minutesOf(o.start_time))) {
    return "La franja se solapa con otra ya existente";
  }
  return null;
};

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
  const [members, setMembers] = useState<Member[]>([]);

  const [newBlock, setNewBlock] = useState({ date: todayMadrid(), start: "17:00", end: "18:15", reason: "" });
  const [newClosure, setNewClosure] = useState({ weekday: 2, start: "17:00", end: "19:00", reason: "" });
  const [newRange, setNewRange] = useState({ name: "", start: "09:00", end: "10:15", price: "20" });
  const [newMember, setNewMember] = useState({ email: "", name: "" });
  const [membershipPrice, setMembershipPrice] = useState("30");

  // Reagendar
  const [reschedId, setReschedId] = useState<string | null>(null);
  const [rsDate, setRsDate] = useState(todayMadrid());
  const [rsSlots, setRsSlots] = useState<Slot[]>([]);
  const [rsLoading, setRsLoading] = useState(false);

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
    const [r, b, c, m, s] = await Promise.all([
      padelDb.from("padel_price_ranges").select("*").eq("tenant_slug", PADEL_TENANT).order("start_time"),
      padelDb
        .from("padel_blocks")
        .select("*")
        .eq("tenant_slug", PADEL_TENANT)
        .gte("block_date", todayMadrid())
        .order("block_date")
        .order("start_time"),
      padelDb.from("padel_weekly_closures").select("*").eq("tenant_slug", PADEL_TENANT).order("weekday").order("start_time"),
      padelDb.from("padel_members").select("*").eq("tenant_slug", PADEL_TENANT).order("email"),
      padelDb.from("padel_settings").select("membership_price_cents").eq("tenant_slug", PADEL_TENANT).maybeSingle(),
    ]);
    setRanges((r.data ?? []) as Range[]);
    setBlocks((b.data ?? []) as Block[]);
    setClosures((c.data ?? []) as Closure[]);
    setMembers((m.data ?? []) as Member[]);
    if (s.data) {
      setMembershipPrice(String((s.data as { membership_price_cents: number }).membership_price_cents / 100));
    }
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

  // ---- Reservas ----
  const cancelBooking = (b: Booking) => {
    if (!window.confirm(`¿Cancelar la reserva de ${b.customer_name}? (El reembolso automático llegará con el pago online.)`)) return;
    run(padelDb.from("padel_bookings").update({ status: "cancelled" }).eq("id", b.id), "Reserva cancelada", loadBookings);
  };

  const loadRsSlots = async (d: string) => {
    setRsLoading(true);
    try {
      setRsSlots(await getSlots(d));
    } catch (e) {
      toast.error((e as Error).message);
      setRsSlots([]);
    } finally {
      setRsLoading(false);
    }
  };

  const openReschedule = (b: Booking) => {
    if (reschedId === b.id) {
      setReschedId(null);
      return;
    }
    setReschedId(b.id);
    setRsDate(date);
    loadRsSlots(date);
  };

  const doReschedule = async (b: Booking, s: Slot) => {
    if (!window.confirm(`¿Mover la reserva de ${b.customer_name} al ${rsDate} a las ${fmtTime(s.start_time)}?`)) return;
    try {
      await rescheduleBooking(b.id, rsDate, s.start_time);
      toast.success(`Reserva reagendada al ${rsDate} a las ${fmtTime(s.start_time)}`);
      setReschedId(null);
      loadBookings();
    } catch (e) {
      toast.error((e as Error).message);
      loadRsSlots(rsDate);
    }
  };

  // ---- Franjas ----
  const saveRange = (r: Range) => {
    const problem = rangeProblem(
      r.start_time,
      r.end_time,
      ranges.filter((x) => x.id !== r.id),
    );
    if (problem) {
      toast.error(problem);
      return;
    }
    if (!r.name.trim()) {
      toast.error("Ponle un nombre a la franja");
      return;
    }
    run(
      padelDb
        .from("padel_price_ranges")
        .update({
          name: r.name.trim(),
          start_time: r.start_time.slice(0, 5),
          end_time: r.end_time.slice(0, 5),
          price_cents: r.price_cents,
        })
        .eq("id", r.id),
      "Franja guardada",
      loadConfig,
    );
  };

  const deleteRange = (r: Range) => {
    if (
      !window.confirm(
        `¿Eliminar la franja "${r.name}"? Las reservas ya hechas no se borran, pero ese tramo dejará de ofrecerse para reservar.`,
      )
    )
      return;
    run(padelDb.from("padel_price_ranges").delete().eq("id", r.id), "Franja eliminada", loadConfig);
  };

  const addRange = () => {
    const problem = rangeProblem(newRange.start, newRange.end, ranges);
    if (problem) {
      toast.error(problem);
      return;
    }
    if (!newRange.name.trim()) {
      toast.error("Ponle un nombre a la franja");
      return;
    }
    const euros = parseFloat(newRange.price);
    if (Number.isNaN(euros) || euros < 0) {
      toast.error("Indica un precio válido");
      return;
    }
    run(
      padelDb.from("padel_price_ranges").insert({
        tenant_slug: PADEL_TENANT,
        name: newRange.name.trim(),
        start_time: newRange.start,
        end_time: newRange.end,
        price_cents: Math.round(euros * 100),
        active: true,
      }),
      "Franja añadida",
      () => {
        setNewRange({ name: "", start: newRange.end, end: newRange.end, price: newRange.price });
        loadConfig();
      },
    );
  };

  // ---- Bloqueos y cierres semanales ----
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

  // ---- Socios ----
  const addMember = () => {
    const mail = newMember.email.trim().toLowerCase();
    if (!mail) {
      toast.error("Indica el email del socio");
      return;
    }
    run(
      padelDb.from("padel_members").insert({
        tenant_slug: PADEL_TENANT,
        email: mail,
        name: newMember.name.trim() || null,
      }),
      "Socio añadido",
      () => {
        setNewMember({ email: "", name: "" });
        loadConfig();
      },
    );
  };

  const toggleMember = (m: Member) =>
    run(
      padelDb.from("padel_members").update({ active: !m.active }).eq("id", m.id),
      m.active ? "Socio desactivado" : "Socio activado",
      loadConfig,
    );

  const removeMember = (m: Member) => {
    if (!window.confirm(`¿Quitar a ${m.email} de los socios?`)) return;
    run(padelDb.from("padel_members").delete().eq("id", m.id), "Socio eliminado", loadConfig);
  };

  const saveMembershipPrice = () => {
    const euros = parseFloat(membershipPrice);
    if (Number.isNaN(euros) || euros < 0) {
      toast.error("Indica un precio válido");
      return;
    }
    run(
      padelDb
        .from("padel_settings")
        .update({ membership_price_cents: Math.round(euros * 100), updated_at: new Date().toISOString() })
        .eq("tenant_slug", PADEL_TENANT),
      "Cuota guardada",
      loadConfig,
    );
  };

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
            <li key={b.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className={b.status === "cancelled" ? "opacity-50 line-through" : ""}>
                  <strong>
                    {fmtTime(b.start_time)} – {fmtTime(b.end_time)}
                  </strong>{" "}
                  · {b.customer_name} · {b.customer_email}
                  {b.customer_phone ? ` · ${b.customer_phone}` : ""} ·{" "}
                  {b.payment_status === "member" ? "Socio" : `${fmtPrice(b.price_cents)} (${b.payment_status})`}
                </div>
                {b.status !== "cancelled" && (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline" onClick={() => openReschedule(b)}>
                      Reagendar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => cancelBooking(b)}>
                      Cancelar
                    </Button>
                  </div>
                )}
              </div>

              {reschedId === b.id && (
                <div className="mt-3 rounded-md bg-muted/40 p-3">
                  <p className="mb-2 text-sm font-medium">Elige el nuevo día y hora</p>
                  <Input
                    type="date"
                    className="mb-3 max-w-xs"
                    value={rsDate}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setRsDate(e.target.value);
                      loadRsSlots(e.target.value);
                    }}
                  />
                  {rsLoading && <p className="text-sm text-muted-foreground">Cargando horarios…</p>}
                  {!rsLoading && rsSlots.filter((s) => s.available).length === 0 && (
                    <p className="text-sm text-muted-foreground">No hay horas libres ese día.</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {rsSlots
                      .filter((s) => s.available)
                      .map((s) => (
                        <Button key={s.start_time} size="sm" variant="outline" onClick={() => doReschedule(b, s)}>
                          {fmtTime(s.start_time)} – {fmtTime(s.end_time)}
                        </Button>
                      ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Se conserva el precio y el estado de pago de la reserva original. Por ahora no se avisa al cliente.
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className={sectionCls}>
        <h2 className="mb-3 font-semibold">Franjas y precios</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Cada franja se divide en reservas de 1h15 y tiene su propio precio. Puedes cambiar el horario y el precio,
          añadir franjas nuevas o eliminar las que no quieras.
        </p>
        <div className="space-y-3">
          {ranges.map((r) => (
            <div key={r.id}>
              <div className="flex flex-wrap items-center gap-2">
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
                <Button size="sm" variant="outline" onClick={() => deleteRange(r)}>
                  Eliminar
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{describeRange(r.start_time, r.end_time)}</p>
            </div>
          ))}
          {ranges.length === 0 && (
            <p className="text-sm text-muted-foreground">No hay franjas: nadie podrá reservar hasta que añadas una.</p>
          )}
        </div>

        <div className="mt-5 border-t pt-4">
          <h3 className="mb-2 text-sm font-medium">Añadir franja</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Nombre (ej. Noche)"
              className="w-36"
              value={newRange.name}
              onChange={(e) => setNewRange({ ...newRange, name: e.target.value })}
            />
            <Input
              type="time"
              className="w-28"
              value={newRange.start}
              onChange={(e) => setNewRange({ ...newRange, start: e.target.value })}
            />
            <Input
              type="time"
              className="w-28"
              value={newRange.end}
              onChange={(e) => setNewRange({ ...newRange, end: e.target.value })}
            />
            <Input
              type="number"
              step="0.5"
              min="0"
              className="w-24"
              value={newRange.price}
              onChange={(e) => setNewRange({ ...newRange, price: e.target.value })}
            />
            <span className="text-sm">€</span>
            <Button size="sm" onClick={addRange}>
              Añadir
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{describeRange(newRange.start, newRange.end)}</p>
        </div>
      </section>

      <section className={sectionCls}>
        <h2 className="mb-3 font-semibold">Socios</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Los socios reservan sin ver precio ni pagar. Para que funcione, el socio debe crear una cuenta en la página de
          reservas con ese mismo email y confirmarlo desde el correo que recibe.
        </p>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm">Cuota mensual:</span>
          <Input
            type="number"
            step="0.5"
            min="0"
            className="w-24"
            value={membershipPrice}
            onChange={(e) => setMembershipPrice(e.target.value)}
          />
          <span className="text-sm">€</span>
          <Button size="sm" onClick={saveMembershipPrice}>
            Guardar cuota
          </Button>
          <span className="text-xs text-muted-foreground">(de momento solo se guarda; todavía no se cobra)</span>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            type="email"
            placeholder="Email del socio"
            className="w-56"
            value={newMember.email}
            onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
          />
          <Input
            placeholder="Nombre (opcional)"
            className="w-44"
            value={newMember.name}
            onChange={(e) => setNewMember({ ...newMember, name: e.target.value })}
          />
          <Button size="sm" onClick={addMember}>
            Añadir socio
          </Button>
        </div>
        {members.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay socios.</p>}
        <ul className="space-y-1 text-sm">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
              <span className={m.active ? "" : "opacity-50"}>
                {m.email}
                {m.name ? ` · ${m.name}` : ""} · {m.active ? "Activo" : "Inactivo"}
              </span>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" onClick={() => toggleMember(m)}>
                  {m.active ? "Desactivar" : "Activar"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => removeMember(m)}>
                  Quitar
                </Button>
              </div>
            </li>
          ))}
        </ul>
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
