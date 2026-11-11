import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type Screen = "dashboard" | "company" | "services" | "requests" | "quotes";

type Summary = {
  tenant: { name: string; slug: string; default_locale: string };
  settings: {
    currency: string;
    tax_rate: string;
    quote_validity_days: number;
    review_required: boolean;
    public_chat_enabled: boolean;
    configuration_version: number;
  };
  counts: { job_types: number; items: number; requests: number; quotes: number };
};

type JobType = { id: string; slug: string; name: string; description?: string | null; status: string };

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json() as Promise<T>;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [services, setServices] = useState<JobType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newService, setNewService] = useState({ slug: "", name: "", description: "" });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextSummary, nextServices] = await Promise.all([
        api<Summary>("/api/v1/backoffice/summary"),
        api<JobType[]>("/api/v1/backoffice/job-types"),
      ]);
      setSummary(nextSummary);
      setServices(nextServices);
    } catch {
      setError("No se ha podido conectar con la API de Horekia.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveSettings = async () => {
    if (!summary) return;
    setSaving(true);
    setError(null);
    try {
      const settings = await api<Summary["settings"]>("/api/v1/backoffice/settings", {
        method: "PATCH",
        body: JSON.stringify({ ...summary.settings, tax_rate: Number(summary.settings.tax_rate) }),
      });
      setSummary({ ...summary, settings });
    } catch {
      setError("No se han podido guardar los cambios.");
    } finally {
      setSaving(false);
    }
  };

  const createService = async () => {
    if (!newService.slug || !newService.name) return;
    setSaving(true);
    setError(null);
    try {
      await api<JobType>("/api/v1/backoffice/job-types", {
        method: "POST",
        body: JSON.stringify(newService),
      });
      setNewService({ slug: "", name: "", description: "" });
      await load();
    } catch {
      setError("No se ha podido crear el servicio. Revisa que el slug no esté repetido.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.sidebar}>
        <Text style={styles.brand}>HOREKIA</Text>
        <Text style={styles.brandSub}>BACKOFFICE</Text>
        <View style={styles.nav}>
          <NavButton label="Resumen" active={screen === "dashboard"} onPress={() => setScreen("dashboard")} />
          <NavButton label="Empresa" active={screen === "company"} onPress={() => setScreen("company")} />
          <NavButton label="Servicios y fichas" active={screen === "services"} onPress={() => setScreen("services")} />
          <NavButton label="Peticiones" active={screen === "requests"} onPress={() => setScreen("requests")} />
          <NavButton label="Presupuestos" active={screen === "quotes"} onPress={() => setScreen("quotes")} />
        </View>
        <View style={styles.sidebarBottom}>
          <Text style={styles.sidebarHint}>Instalación POC</Text>
          <Text style={styles.sidebarMuted}>{summary?.tenant.name ?? "Cargando empresa…"}</Text>
        </View>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        <View style={styles.topbar}>
          <View>
            <Text style={styles.kicker}>OPERACIÓN</Text>
            <Text style={styles.heading}>{screenTitle(screen)}</Text>
          </View>
          <Pressable style={styles.refreshButton} onPress={() => void load()}>
            <Text style={styles.refreshLabel}>Actualizar</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading && !summary ? (
          <ActivityIndicator color="#147d68" size="large" style={styles.loader} />
        ) : summary ? (
          <>
            {screen === "dashboard" ? <Dashboard summary={summary} /> : null}
            {screen === "company" ? (
              <Company summary={summary} setSummary={setSummary} onSave={saveSettings} saving={saving} />
            ) : null}
            {screen === "services" ? (
              <Services services={services} newService={newService} setNewService={setNewService} onCreate={createService} saving={saving} />
            ) : null}
            {screen === "requests" ? <ModulePlaceholder title="Peticiones" text="La bandeja de peticiones será el siguiente incremento del backoffice." /> : null}
            {screen === "quotes" ? <ModulePlaceholder title="Presupuestos" text="El motor determinista y la revisión de presupuestos se incorporarán después." /> : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function NavButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable style={[styles.navButton, active && styles.navButtonActive]} onPress={onPress}><Text style={[styles.navLabel, active && styles.navLabelActive]}>{label}</Text></Pressable>;
}

function Dashboard({ summary }: { summary: Summary }) {
  return (
    <View>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Todo listo para configurar {summary.tenant.name}</Text>
        <Text style={styles.heroText}>Define servicios, fichas y reglas para preparar presupuestos revisables.</Text>
        <Text style={styles.version}>Configuración v{summary.settings.configuration_version}</Text>
      </View>
      <View style={styles.cards}>
        <Metric label="Servicios" value={summary.counts.job_types} />
        <Metric label="Partidas de catálogo" value={summary.counts.items} />
        <Metric label="Peticiones" value={summary.counts.requests} />
        <Metric label="Presupuestos" value={summary.counts.quotes} />
      </View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Estado de la instalación</Text>
        <StatusRow label="Base de datos" value="Conectada" good />
        <StatusRow label="IA" value="Gemini configurado" good />
        <StatusRow label="Revisión humana" value={summary.settings.review_required ? "Activa" : "Desactivada"} good={summary.settings.review_required} />
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function StatusRow({ label, value, good }: { label: string; value: string; good: boolean }) {
  return <View style={styles.statusRow}><Text style={styles.statusRowLabel}>{label}</Text><Text style={[styles.statusRowValue, !good && styles.statusOff]}>{value}</Text></View>;
}

function Company({ summary, setSummary, onSave, saving }: { summary: Summary; setSummary: (summary: Summary) => void; onSave: () => void; saving: boolean }) {
  const update = (patch: Partial<Summary["settings"]>) => setSummary({ ...summary, settings: { ...summary.settings, ...patch } });
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Configuración de empresa</Text>
      <Text style={styles.fieldLabel}>Nombre</Text>
      <Text style={styles.readonly}>{summary.tenant.name}</Text>
      <View style={styles.formGrid}>
        <Field label="Moneda" value={summary.settings.currency} onChangeText={(currency) => update({ currency })} />
        <Field label="IVA (%)" value={String(summary.settings.tax_rate)} keyboardType="decimal-pad" onChangeText={(tax_rate) => update({ tax_rate })} />
        <Field label="Validez (días)" value={String(summary.settings.quote_validity_days)} keyboardType="number-pad" onChangeText={(value) => update({ quote_validity_days: Number(value) || 0 })} />
      </View>
      <Toggle label="Revisión humana obligatoria" value={summary.settings.review_required} onPress={() => update({ review_required: !summary.settings.review_required })} />
      <Toggle label="Chat público habilitado" value={summary.settings.public_chat_enabled} onPress={() => update({ public_chat_enabled: !summary.settings.public_chat_enabled })} />
      <Pressable style={styles.primaryButton} onPress={onSave} disabled={saving}><Text style={styles.primaryLabel}>{saving ? "Guardando…" : "Guardar cambios"}</Text></Pressable>
    </View>
  );
}

function Services({ services, newService, setNewService, onCreate, saving }: { services: JobType[]; newService: { slug: string; name: string; description: string }; setNewService: (value: { slug: string; name: string; description: string }) => void; onCreate: () => void; saving: boolean }) {
  return (
    <View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Nuevo servicio</Text>
        <View style={styles.formGrid}>
          <Field label="Slug" value={newService.slug} onChangeText={(slug) => setNewService({ ...newService, slug })} />
          <Field label="Nombre" value={newService.name} onChangeText={(name) => setNewService({ ...newService, name })} />
        </View>
        <Field label="Descripción" value={newService.description} onChangeText={(description) => setNewService({ ...newService, description })} />
        <Pressable style={styles.primaryButton} onPress={onCreate} disabled={saving}><Text style={styles.primaryLabel}>{saving ? "Guardando…" : "Añadir servicio"}</Text></Pressable>
      </View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Servicios configurados</Text>
        {services.map((service) => <View style={styles.listRow} key={service.id}><View><Text style={styles.listTitle}>{service.name}</Text><Text style={styles.listMeta}>{service.slug} · {service.status}</Text></View><Text style={styles.listArrow}>›</Text></View>)}
      </View>
    </View>
  );
}

function Field({ label, value, onChangeText, keyboardType }: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: "default" | "decimal-pad" | "number-pad" }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput style={styles.input} value={value} onChangeText={onChangeText} keyboardType={keyboardType} /></View>;
}

function Toggle({ label, value, onPress }: { label: string; value: boolean; onPress: () => void }) {
  return <Pressable style={styles.toggle} onPress={onPress}><View style={[styles.checkbox, value && styles.checkboxOn]}>{value ? <Text style={styles.check}>✓</Text> : null}</View><Text style={styles.toggleLabel}>{label}</Text></Pressable>;
}

function ModulePlaceholder({ title, text }: { title: string; text: string }) {
  return <View style={styles.empty}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyText}>{text}</Text></View>;
}

function screenTitle(screen: Screen) {
  return { dashboard: "Resumen", company: "Empresa", services: "Servicios y fichas", requests: "Peticiones", quotes: "Presupuestos" }[screen];
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: "row", backgroundColor: "#f6f7f5" },
  sidebar: { width: 250, padding: 28, backgroundColor: "#17332d", minHeight: "100%" },
  brand: { color: "#e7f2e9", fontSize: 22, fontWeight: "800", letterSpacing: 2 },
  brandSub: { color: "#8fc6a9", fontSize: 11, letterSpacing: 2, marginTop: 4 },
  nav: { gap: 6, marginTop: 48 },
  navButton: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12 },
  navButtonActive: { backgroundColor: "#28604d" },
  navLabel: { color: "#b4c8bd", fontSize: 14 },
  navLabelActive: { color: "#ffffff", fontWeight: "700" },
  sidebarBottom: { marginTop: "auto", paddingTop: 32 },
  sidebarHint: { color: "#8fc6a9", fontSize: 12 },
  sidebarMuted: { color: "#d7e6dc", fontSize: 13, marginTop: 6 },
  content: { flex: 1 },
  contentInner: { padding: 42, maxWidth: 1200, width: "100%", alignSelf: "center" },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 28 },
  kicker: { color: "#258269", fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  heading: { color: "#17211f", fontSize: 32, fontWeight: "800", marginTop: 6 },
  refreshButton: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  refreshLabel: { color: "#285246", fontSize: 13, fontWeight: "600" },
  error: { color: "#a53d35", backgroundColor: "#fdecea", borderRadius: 8, padding: 14, marginBottom: 18 },
  loader: { marginTop: 80 },
  hero: { backgroundColor: "#dff0e5", borderRadius: 16, padding: 26, marginBottom: 18 },
  heroTitle: { color: "#17332d", fontSize: 23, fontWeight: "800", maxWidth: 650 },
  heroText: { color: "#416457", fontSize: 15, marginTop: 9 },
  version: { color: "#258269", fontSize: 12, fontWeight: "700", marginTop: 20 },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginBottom: 18 },
  metric: { backgroundColor: "#ffffff", borderRadius: 12, padding: 20, minWidth: 150, flexGrow: 1, flexBasis: "20%", borderWidth: 1, borderColor: "#e1e8e3" },
  metricValue: { color: "#17332d", fontSize: 28, fontWeight: "800" },
  metricLabel: { color: "#61736a", fontSize: 13, marginTop: 6 },
  panel: { backgroundColor: "#ffffff", borderRadius: 14, padding: 24, borderWidth: 1, borderColor: "#e1e8e3", marginBottom: 18 },
  panelTitle: { color: "#17332d", fontSize: 18, fontWeight: "700", marginBottom: 20 },
  statusRow: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "#edf1ee", paddingVertical: 14 },
  statusRowLabel: { color: "#52645b", fontSize: 14 },
  statusRowValue: { color: "#258269", fontSize: 14, fontWeight: "700" },
  statusOff: { color: "#9a6b27" },
  field: { flex: 1, marginBottom: 16 },
  fieldLabel: { color: "#52645b", fontSize: 12, fontWeight: "700", marginBottom: 7 },
  readonly: { color: "#17332d", fontSize: 16, paddingBottom: 18 },
  formGrid: { flexDirection: "row", gap: 14 },
  input: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11, color: "#17332d", backgroundColor: "#fbfcfb" },
  toggle: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1, borderColor: "#b7c8be", alignItems: "center", justifyContent: "center", marginRight: 10 },
  checkboxOn: { backgroundColor: "#258269", borderColor: "#258269" },
  check: { color: "#ffffff", fontSize: 14, fontWeight: "800" },
  toggleLabel: { color: "#344a41", fontSize: 14 },
  primaryButton: { alignSelf: "flex-start", backgroundColor: "#258269", borderRadius: 8, paddingHorizontal: 18, paddingVertical: 12, marginTop: 8 },
  primaryLabel: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
  listRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: "#edf1ee", paddingVertical: 16 },
  listTitle: { color: "#17332d", fontSize: 15, fontWeight: "700" },
  listMeta: { color: "#718078", fontSize: 12, marginTop: 4 },
  listArrow: { color: "#258269", fontSize: 28 },
  empty: { backgroundColor: "#ffffff", borderRadius: 14, borderWidth: 1, borderColor: "#e1e8e3", padding: 34 },
  emptyTitle: { color: "#17332d", fontSize: 20, fontWeight: "800" },
  emptyText: { color: "#61736a", fontSize: 15, lineHeight: 23, marginTop: 10 },
});
