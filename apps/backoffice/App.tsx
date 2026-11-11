import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type Screen = "wizard" | "dashboard" | "company" | "services" | "requests" | "quotes";

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
type NewService = { slug: string; name: string; description: string };
type KnowledgeRow = { kind: string; title: string; content: string; code?: string; category?: string; unit: string; base_price?: number; currency: string; metadata: Record<string, string> };
type KnowledgeSummary = { total: number; by_kind: { kind: string; count: number }[] };
type KnowledgeEntry = { id: string; kind: string; title: string; source_name?: string | null };

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";
const WIZARD_STORAGE_KEY = "horekia.backoffice.onboarding.completed";

function isWizardCompleted() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(WIZARD_STORAGE_KEY) === "true";
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json() as Promise<T>;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => (isWizardCompleted() ? "dashboard" : "wizard"));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [services, setServices] = useState<JobType[]>([]);
  const [knowledgeSummary, setKnowledgeSummary] = useState<KnowledgeSummary>({ total: 0, by_kind: [] });
  const [knowledgeEntries, setKnowledgeEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextSummary, nextServices, nextKnowledgeSummary, nextKnowledgeEntries] = await Promise.all([
        api<Summary>("/api/v1/backoffice/summary"),
        api<JobType[]>("/api/v1/backoffice/job-types"),
        api<KnowledgeSummary>("/api/v1/backoffice/knowledge/summary"),
        api<KnowledgeEntry[]>("/api/v1/backoffice/knowledge/entries"),
      ]);
      setSummary(nextSummary);
      setServices(nextServices);
      setKnowledgeSummary(nextKnowledgeSummary);
      setKnowledgeEntries(nextKnowledgeEntries);
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

  const createService = async (newService: NewService) => {
    if (!newService.slug || !newService.name) return false;
    setSaving(true);
    setError(null);
    try {
      await api<JobType>("/api/v1/backoffice/job-types", {
        method: "POST",
        body: JSON.stringify(newService),
      });
      await load();
      return true;
    } catch {
      setError("No se ha podido crear el servicio. Revisa que el slug no esté repetido.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const importKnowledge = async (sourceName: string, rows: KnowledgeRow[]) => {
    setSaving(true);
    setError(null);
    try {
      await api("/api/v1/backoffice/knowledge/import", {
        method: "POST",
        body: JSON.stringify({ source_name: sourceName, rows }),
      });
      await load();
      return true;
    } catch {
      setError("No se ha podido importar el CSV de conocimiento.");
      return false;
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
          <NavButton label="Wizard" active={screen === "wizard"} onPress={() => setScreen("wizard")} />
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
            {screen === "wizard" ? (
              <Wizard summary={summary} services={services} knowledgeSummary={knowledgeSummary} knowledgeEntries={knowledgeEntries} onComplete={() => setScreen("dashboard")} onCreateService={createService} onImportKnowledge={importKnowledge} saving={saving} />
            ) : null}
            {screen === "dashboard" ? <Dashboard summary={summary} /> : null}
            {screen === "company" ? (
              <Company summary={summary} setSummary={setSummary} onSave={saveSettings} saving={saving} />
            ) : null}
            {screen === "services" ? (
              <Services services={services} onCreate={createService} saving={saving} />
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

function Wizard({ summary, services, knowledgeSummary, knowledgeEntries, onComplete, onCreateService, onImportKnowledge, saving }: { summary: Summary; services: JobType[]; knowledgeSummary: KnowledgeSummary; knowledgeEntries: KnowledgeEntry[]; onComplete: () => void; onCreateService: (service: NewService) => Promise<boolean>; onImportKnowledge: (sourceName: string, rows: KnowledgeRow[]) => Promise<boolean>; saving: boolean }) {
  const [step, setStep] = useState(0);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const steps = ["Empresa", "Oferta", "Conocimiento", "Revisión"];
  const finish = () => {
    if (typeof window !== "undefined") window.localStorage.setItem(WIZARD_STORAGE_KEY, "true");
    onComplete();
  };

  return (
    <View>
      <View style={styles.wizardHero}>
        <Text style={styles.wizardEyebrow}>PRIMERA CONFIGURACIÓN</Text>
        <Text style={styles.wizardTitle}>Configura {summary.tenant.name} paso a paso</Text>
        <Text style={styles.wizardText}>Puedes salir y volver desde el menú Wizard en cualquier momento.</Text>
      </View>
      <View style={styles.stepper}>
        {steps.map((label, index) => <View style={styles.step} key={label}><View style={[styles.stepDot, index <= step && styles.stepDotActive]}><Text style={styles.stepNumber}>{index + 1}</Text></View><Text style={[styles.stepLabel, index === step && styles.stepLabelActive]}>{label}</Text></View>)}
      </View>
      <View style={styles.panel}>
        {step === 0 ? (
          <>
            <Text style={styles.panelTitle}>1. Datos de empresa</Text>
            <Text style={styles.wizardText}>Esta instalación está vinculada a:</Text>
            <Text style={styles.wizardTenant}>{summary.tenant.name}</Text>
            <Text style={styles.listMeta}>Idioma inicial: {summary.tenant.default_locale}</Text>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <Text style={styles.panelTitle}>2. Oferta y servicios</Text>
            <Text style={styles.wizardText}>Define qué vende o qué trabajos realiza tu empresa. Los servicios se añaden aquí sin abandonar el Wizard.</Text>
            {services.slice(0, 3).map((service) => <Text style={styles.wizardBullet} key={service.id}>• {service.name}</Text>)}
            <Pressable style={styles.secondaryButton} onPress={() => setServiceModalOpen(true)}><Text style={styles.secondaryLabel}>Añadir servicio</Text></Pressable>
          </>
        ) : null}
        {step === 2 ? (
          <>
            <Text style={styles.panelTitle}>3. Base de conocimiento</Text>
            <Text style={styles.wizardText}>Carga productos, categorías, patrones de venta, políticas o documentación. Gemini podrá consultarlos como contexto; los precios que generen presupuestos seguirán siendo deterministas.</Text>
            <KnowledgeImport knowledgeSummary={knowledgeSummary} knowledgeEntries={knowledgeEntries} onImport={onImportKnowledge} saving={saving} />
          </>
        ) : null}
        {step === 3 ? (
          <>
            <Text style={styles.panelTitle}>4. Revisar y terminar</Text>
            <Text style={styles.wizardText}>La revisión humana está {summary.settings.review_required ? "activa" : "desactivada"}, hay {services.length} servicio(s) y {knowledgeSummary.total} entrada(s) de conocimiento.</Text>
            <Text style={styles.wizardText}>Al terminar podrás volver a ejecutar este Wizard desde el menú cuando quieras.</Text>
          </>
        ) : null}
        <View style={styles.wizardActions}>
          {step > 0 ? <Pressable style={styles.secondaryButton} onPress={() => setStep(step - 1)}><Text style={styles.secondaryLabel}>Anterior</Text></Pressable> : <View />}
          {step < steps.length - 1 ? <Pressable style={styles.primaryButton} onPress={() => setStep(step + 1)}><Text style={styles.primaryLabel}>Continuar</Text></Pressable> : <Pressable style={styles.primaryButton} onPress={finish}><Text style={styles.primaryLabel}>Terminar configuración</Text></Pressable>}
        </View>
      </View>
      <ServiceModal visible={serviceModalOpen} onClose={() => setServiceModalOpen(false)} onCreate={onCreateService} saving={saving} />
    </View>
  );
}

function KnowledgeImport({ knowledgeSummary, knowledgeEntries, onImport, saving }: { knowledgeSummary: KnowledgeSummary; knowledgeEntries: KnowledgeEntry[]; onImport: (sourceName: string, rows: KnowledgeRow[]) => Promise<boolean>; saving: boolean }) {
  const [sourceName, setSourceName] = useState("");
  const [rows, setRows] = useState<KnowledgeRow[]>([]);

  const chooseCsv = () => {
    if (typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setSourceName(file.name);
      setRows(parseKnowledgeCsv(await file.text()));
    };
    input.click();
  };

  const importRows = async () => {
    if (!sourceName || rows.length === 0) return;
    if (await onImport(sourceName, rows)) setRows([]);
  };

  return (
    <View style={styles.knowledgeBox}>
      <Text style={styles.fieldLabel}>CSV de conocimiento</Text>
      <Text style={styles.listMeta}>Columnas admitidas: title/name, kind, content/description, code/sku, category, unit, base_price y currency.</Text>
      <Pressable style={styles.secondaryButton} onPress={chooseCsv}><Text style={styles.secondaryLabel}>{sourceName || "Seleccionar CSV"}</Text></Pressable>
      {rows.length > 0 ? <Text style={styles.wizardText}>{rows.length} fila(s) listas para importar.</Text> : null}
      <Pressable style={styles.primaryButton} onPress={importRows} disabled={saving || rows.length === 0}><Text style={styles.primaryLabel}>{saving ? "Importando…" : "Importar conocimiento"}</Text></Pressable>
      <Text style={styles.knowledgeCount}>Base actual: {knowledgeSummary.total} entradas · {knowledgeEntries.slice(0, 3).map((entry) => entry.title).join(", ") || "sin entradas"}</Text>
    </View>
  );
}

function parseKnowledgeCsv(text: string): KnowledgeRow[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const headers = splitCsvLine(lines[0], delimiter).map((header) => header.trim().toLowerCase().replace(/[áéíóú]/g, (letter) => ({ á: "a", é: "e", í: "i", ó: "o", ú: "u" }[letter] ?? letter)));
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line, delimiter);
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""]));
    const known = new Set(["kind", "tipo", "title", "name", "nombre", "producto", "content", "description", "descripcion", "code", "sku", "codigo", "category", "categoria", "unit", "unidad", "base_price", "price", "precio", "currency", "moneda"]);
    const metadata = Object.fromEntries(Object.entries(record).filter(([key, value]) => !known.has(key) && value));
    const priceValue = record.base_price || record.price || record.precio;
    const price = priceValue ? Number(priceValue.replace(",", ".")) : undefined;
    return {
      kind: record.kind || record.tipo || "product",
      title: record.title || record.name || record.nombre || record.producto || "Entrada sin título",
      content: record.content || record.description || record.descripcion || "",
      code: record.code || record.sku || record.codigo || undefined,
      category: record.category || record.categoria || undefined,
      unit: record.unit || record.unidad || "unit",
      base_price: Number.isFinite(price) ? price : undefined,
      currency: (record.currency || record.moneda || "EUR").toUpperCase(),
      metadata,
    };
  });
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === delimiter && !quoted) { values.push(value); value = ""; }
    else value += character;
  }
  values.push(value);
  return values;
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

function Services({ services, onCreate, saving }: { services: JobType[]; onCreate: (service: NewService) => Promise<boolean>; saving: boolean }) {
  const [modalVisible, setModalVisible] = useState(false);
  return (
    <View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Servicios y fichas</Text>
        <Text style={styles.wizardText}>Los servicios definen las líneas de negocio que el tenant puede presupuestar.</Text>
        <Pressable style={styles.primaryButton} onPress={() => setModalVisible(true)} disabled={saving}><Text style={styles.primaryLabel}>Nuevo servicio</Text></Pressable>
      </View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Servicios configurados</Text>
        {services.map((service) => <View style={styles.listRow} key={service.id}><View><Text style={styles.listTitle}>{service.name}</Text><Text style={styles.listMeta}>{service.slug} · {service.status}</Text></View><Text style={styles.listArrow}>›</Text></View>)}
      </View>
      <ServiceModal visible={modalVisible} onClose={() => setModalVisible(false)} onCreate={onCreate} saving={saving} />
    </View>
  );
}

function ServiceModal({ visible, onClose, onCreate, saving }: { visible: boolean; onClose: () => void; onCreate: (service: NewService) => Promise<boolean>; saving: boolean }) {
  const [draft, setDraft] = useState<NewService>({ slug: "", name: "", description: "" });
  const submit = async () => {
    if (await onCreate(draft)) {
      setDraft({ slug: "", name: "", description: "" });
      onClose();
    }
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}><Text style={styles.panelTitle}>Añadir servicio</Text><Pressable onPress={onClose}><Text style={styles.modalClose}>×</Text></Pressable></View>
          <Text style={styles.wizardText}>Añádelo sin salir del contexto del Wizard o del catálogo.</Text>
          <View style={styles.formGrid}>
            <Field label="Slug" value={draft.slug} onChangeText={(slug) => setDraft({ ...draft, slug })} />
            <Field label="Nombre" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
          </View>
          <Field label="Descripción" value={draft.description} onChangeText={(description) => setDraft({ ...draft, description })} />
          <View style={styles.wizardActions}><Pressable style={styles.secondaryButton} onPress={onClose}><Text style={styles.secondaryLabel}>Cancelar</Text></Pressable><Pressable style={styles.primaryButton} onPress={submit} disabled={saving}><Text style={styles.primaryLabel}>{saving ? "Guardando…" : "Añadir servicio"}</Text></Pressable></View>
        </View>
      </View>
    </Modal>
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
  return { wizard: "Wizard", dashboard: "Resumen", company: "Empresa", services: "Servicios y fichas", requests: "Peticiones", quotes: "Presupuestos" }[screen];
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
  wizardHero: { backgroundColor: "#e8eefb", borderRadius: 16, padding: 26, marginBottom: 18 },
  wizardEyebrow: { color: "#4d64a1", fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  wizardTitle: { color: "#1e2b4d", fontSize: 24, fontWeight: "800", marginTop: 7 },
  wizardText: { color: "#526078", fontSize: 15, lineHeight: 23, marginTop: 8 },
  wizardTenant: { color: "#17332d", fontSize: 20, fontWeight: "800", marginTop: 18 },
  wizardBullet: { color: "#344a41", fontSize: 15, marginTop: 10 },
  stepper: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18, paddingHorizontal: 8 },
  step: { alignItems: "center", flex: 1 },
  stepDot: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: "#cbd8d1", alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff" },
  stepDotActive: { backgroundColor: "#258269", borderColor: "#258269" },
  stepNumber: { color: "#ffffff", fontSize: 12, fontWeight: "700" },
  stepLabel: { color: "#718078", fontSize: 12, marginTop: 7 },
  stepLabelActive: { color: "#258269", fontWeight: "700" },
  wizardActions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 24 },
  knowledgeBox: { backgroundColor: "#f7f9fc", borderRadius: 10, padding: 16, marginTop: 18 },
  knowledgeCount: { color: "#61736a", fontSize: 12, lineHeight: 18, marginTop: 14 },
  secondaryButton: { alignSelf: "flex-start", borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 11, marginTop: 16 },
  secondaryLabel: { color: "#285246", fontSize: 14, fontWeight: "600" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(23, 51, 45, 0.36)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 620, backgroundColor: "#ffffff", borderRadius: 16, padding: 24, shadowColor: "#000000", shadowOpacity: 0.15, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalClose: { color: "#52645b", fontSize: 28, lineHeight: 28, paddingHorizontal: 6 },
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
