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
type TenantProfile = {
  legal_name: string | null;
  display_name: string | null;
  tax_id: string | null;
  contact_name: string | null;
  contact_role: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  billing_email: string | null;
  quotes_email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  region: string | null;
  country: string;
  quote_document_type: "quote" | "proforma";
  quote_template_available: boolean;
  quote_template_filename: string;
  disclaimers: string | null;
  warranty_terms: string | null;
  metadata: Record<string, unknown>;
};
type BlueprintField = { key: string; label: string; type: string; required: boolean; options: string[]; unit?: string; min?: number; max?: number; help_text?: string };
type BlueprintItem = { sku: string; name: string; description?: string; unit: string; base_price?: number; currency: string; metadata: Record<string, unknown> };
type BlueprintRule = { code: string; kind: string; priority: number; definition: Record<string, unknown> };
type ServiceBlueprint = { version?: number; fields: BlueprintField[]; items: BlueprintItem[]; rules: BlueprintRule[]; measures: Array<{ code: string; expression: Record<string, unknown> }> };

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";
const WIZARD_STORAGE_KEY = "horekia.backoffice.onboarding.completed";

function isWizardCompleted() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(WIZARD_STORAGE_KEY) === "true";
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const isMultipart = typeof FormData !== "undefined" && options?.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    headers: isMultipart ? options?.headers : { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    ...options,
  });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json() as Promise<T>;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => (isWizardCompleted() ? "dashboard" : "wizard"));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [profile, setProfile] = useState<TenantProfile | null>(null);
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
      const nextProfile = await api<TenantProfile>("/api/v1/backoffice/profile");
      setSummary(nextSummary);
      setProfile(nextProfile);
      setServices(nextServices);
      setKnowledgeSummary(nextKnowledgeSummary);
      setKnowledgeEntries(nextKnowledgeEntries);
    } catch {
      setError("No se ha podido conectar con la API de Horekia.");
    } finally {
      setLoading(false);
    }
  };

  const saveProfile = async (nextProfile: TenantProfile) => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api<TenantProfile>("/api/v1/backoffice/profile", {
        method: "PATCH",
        body: JSON.stringify(nextProfile),
      });
      setProfile(saved);
      return true;
    } catch {
      setError("No se ha podido guardar la ficha de empresa.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const uploadTemplate = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    setSaving(true);
    setError(null);
    try {
      await api("/api/v1/backoffice/profile/quote-template", { method: "POST", body: form });
      await load();
      return true;
    } catch {
      setError("No se ha podido cargar la plantilla PDF.");
      return false;
    } finally {
      setSaving(false);
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

  const loadBlueprint = async (jobTypeId: string) => {
    try {
      return await api<ServiceBlueprint>(`/api/v1/backoffice/job-types/${jobTypeId}/blueprint`);
    } catch {
      setError("No se ha podido cargar el patrón del servicio.");
      return null;
    }
  };

  const saveBlueprint = async (jobTypeId: string, blueprint: ServiceBlueprint) => {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/v1/backoffice/job-types/${jobTypeId}/blueprint`, { method: "PUT", body: JSON.stringify(blueprint) });
      await load();
      return true;
    } catch {
      setError("No se ha podido guardar el patrón del servicio.");
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
        {loading && (!summary || !profile) ? (
          <ActivityIndicator color="#147d68" size="large" style={styles.loader} />
        ) : summary && profile ? (
          <>
            {screen === "wizard" ? (
              <Wizard summary={summary} profile={profile} setProfile={setProfile} services={services} knowledgeSummary={knowledgeSummary} knowledgeEntries={knowledgeEntries} onComplete={() => setScreen("dashboard")} onSaveProfile={saveProfile} onUploadTemplate={uploadTemplate} onCreateService={createService} onImportKnowledge={importKnowledge} onLoadBlueprint={loadBlueprint} onSaveBlueprint={saveBlueprint} saving={saving} />
            ) : null}
            {screen === "dashboard" ? <Dashboard summary={summary} /> : null}
            {screen === "company" ? (
              <Company summary={summary} setSummary={setSummary} onSave={saveSettings} saving={saving} />
            ) : null}
            {screen === "services" ? (
              <Services services={services} onCreate={createService} onLoadBlueprint={loadBlueprint} onSaveBlueprint={saveBlueprint} saving={saving} />
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

function Wizard({ summary, profile, setProfile, services, knowledgeSummary, knowledgeEntries, onComplete, onSaveProfile, onUploadTemplate, onCreateService, onImportKnowledge, onLoadBlueprint, onSaveBlueprint, saving }: { summary: Summary; profile: TenantProfile; setProfile: (profile: TenantProfile) => void; services: JobType[]; knowledgeSummary: KnowledgeSummary; knowledgeEntries: KnowledgeEntry[]; onComplete: () => void; onSaveProfile: (profile: TenantProfile) => Promise<boolean>; onUploadTemplate: (file: File) => Promise<boolean>; onCreateService: (service: NewService) => Promise<boolean>; onImportKnowledge: (sourceName: string, rows: KnowledgeRow[]) => Promise<boolean>; onLoadBlueprint: (jobTypeId: string) => Promise<ServiceBlueprint | null>; onSaveBlueprint: (jobTypeId: string, blueprint: ServiceBlueprint) => Promise<boolean>; saving: boolean }) {
  const [step, setStep] = useState(0);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [designerService, setDesignerService] = useState<JobType | null>(null);
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
            <TenantProfileForm profile={profile} setProfile={setProfile} onSave={onSaveProfile} onUploadTemplate={onUploadTemplate} saving={saving} fallbackName={summary.tenant.name} />
          </>
        ) : null}
        {step === 1 ? (
          <>
            <Text style={styles.panelTitle}>2. Oferta y servicios</Text>
            <Text style={styles.wizardText}>Define qué vende o qué trabajos realiza tu empresa. Los servicios se añaden aquí sin abandonar el Wizard.</Text>
            {services.slice(0, 3).map((service) => <View style={styles.serviceSummaryRow} key={service.id}><Text style={styles.wizardBullet}>• {service.name}</Text><Pressable style={styles.smallButton} onPress={() => setDesignerService(service)}><Text style={styles.smallButtonLabel}>Diseñar</Text></Pressable></View>)}
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
      {designerService ? <ServiceDesignerModal visible service={designerService} onClose={() => setDesignerService(null)} onLoad={onLoadBlueprint} onSave={onSaveBlueprint} saving={saving} /> : null}
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

function TenantProfileForm({ profile, setProfile, onSave, onUploadTemplate, saving, fallbackName }: { profile: TenantProfile; setProfile: (profile: TenantProfile) => void; onSave: (profile: TenantProfile) => Promise<boolean>; onUploadTemplate: (file: File) => Promise<boolean>; saving: boolean; fallbackName: string }) {
  const update = (patch: Partial<TenantProfile>) => setProfile({ ...profile, ...patch });
  const chooseTemplate = () => {
    if (typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) await onUploadTemplate(file);
    };
    input.click();
  };
  return (
    <View>
      <Text style={styles.wizardText}>Esta instalación está vinculada a {fallbackName}. Completa la información que aparecerá en presupuestos y comunicaciones.</Text>
      <View style={styles.formGrid}>
        <Field label="Nombre comercial" value={profile.display_name ?? ""} onChangeText={(display_name) => update({ display_name })} />
        <Field label="Razón social" value={profile.legal_name ?? ""} onChangeText={(legal_name) => update({ legal_name })} />
      </View>
      <View style={styles.formGrid}>
        <Field label="NIF/CIF" value={profile.tax_id ?? ""} onChangeText={(tax_id) => update({ tax_id })} />
        <Field label="Teléfono" value={profile.contact_phone ?? ""} onChangeText={(contact_phone) => update({ contact_phone })} />
      </View>
      <Text style={styles.sectionLabel}>Persona responsable</Text>
      <View style={styles.formGrid}>
        <Field label="Nombre" value={profile.contact_name ?? ""} onChangeText={(contact_name) => update({ contact_name })} />
        <Field label="Cargo" value={profile.contact_role ?? ""} onChangeText={(contact_role) => update({ contact_role })} />
      </View>
      <View style={styles.formGrid}>
        <Field label="Email de contacto" value={profile.contact_email ?? ""} onChangeText={(contact_email) => update({ contact_email })} />
        <Field label="Email de presupuestos" value={profile.quotes_email ?? ""} onChangeText={(quotes_email) => update({ quotes_email })} />
      </View>
      <Field label="Email de facturación" value={profile.billing_email ?? ""} onChangeText={(billing_email) => update({ billing_email })} />
      <Text style={styles.sectionLabel}>Dirección</Text>
      <Field label="Dirección" value={profile.address_line1 ?? ""} onChangeText={(address_line1) => update({ address_line1 })} />
      <View style={styles.formGrid}>
        <Field label="Código postal" value={profile.postal_code ?? ""} onChangeText={(postal_code) => update({ postal_code })} />
        <Field label="Ciudad" value={profile.city ?? ""} onChangeText={(city) => update({ city })} />
        <Field label="Provincia/Región" value={profile.region ?? ""} onChangeText={(region) => update({ region })} />
      </View>
      <Text style={styles.sectionLabel}>Documento comercial</Text>
      <Text style={styles.fieldLabel}>Modelo que generará el presupuesto</Text>
      <View style={styles.documentChoices}>
        <Pressable style={[styles.documentChoice, profile.quote_document_type === "quote" && styles.documentChoiceActive]} onPress={() => update({ quote_document_type: "quote" })}><Text style={styles.documentChoiceLabel}>Presupuesto</Text></Pressable>
        <Pressable style={[styles.documentChoice, profile.quote_document_type === "proforma" && styles.documentChoiceActive]} onPress={() => update({ quote_document_type: "proforma" })}><Text style={styles.documentChoiceLabel}>Proforma</Text></Pressable>
      </View>
      <Pressable style={styles.secondaryButton} onPress={chooseTemplate} disabled={saving}><Text style={styles.secondaryLabel}>{profile.quote_template_filename || "Cargar modelo PDF"}</Text></Pressable>
      <Text style={styles.listMeta}>La plantilla se guarda en la base Horekia de la POC. Más adelante podrá trasladarse a Storage privado.</Text>
      <Field label="Disclaimers" value={profile.disclaimers ?? ""} onChangeText={(disclaimers) => update({ disclaimers })} multiline />
      <Field label="Garantía y condiciones" value={profile.warranty_terms ?? ""} onChangeText={(warranty_terms) => update({ warranty_terms })} multiline />
      <Pressable style={styles.primaryButton} onPress={() => void onSave(profile)} disabled={saving}><Text style={styles.primaryLabel}>{saving ? "Guardando…" : "Guardar datos de empresa"}</Text></Pressable>
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

function Services({ services, onCreate, onLoadBlueprint, onSaveBlueprint, saving }: { services: JobType[]; onCreate: (service: NewService) => Promise<boolean>; onLoadBlueprint: (jobTypeId: string) => Promise<ServiceBlueprint | null>; onSaveBlueprint: (jobTypeId: string, blueprint: ServiceBlueprint) => Promise<boolean>; saving: boolean }) {
  const [modalVisible, setModalVisible] = useState(false);
  const [designerService, setDesignerService] = useState<JobType | null>(null);
  return (
    <View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Servicios y fichas</Text>
        <Text style={styles.wizardText}>Los servicios definen las líneas de negocio que el tenant puede presupuestar.</Text>
        <Pressable style={styles.primaryButton} onPress={() => setModalVisible(true)} disabled={saving}><Text style={styles.primaryLabel}>Nuevo servicio</Text></Pressable>
      </View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Servicios configurados</Text>
        {services.map((service) => <View style={styles.listRow} key={service.id}><View><Text style={styles.listTitle}>{service.name}</Text><Text style={styles.listMeta}>{service.slug} · {service.status}</Text></View><Pressable style={styles.smallButton} onPress={() => setDesignerService(service)}><Text style={styles.smallButtonLabel}>Diseñar</Text></Pressable></View>)}
      </View>
      <ServiceModal visible={modalVisible} onClose={() => setModalVisible(false)} onCreate={onCreate} saving={saving} />
      {designerService ? <ServiceDesignerModal visible service={designerService} onClose={() => setDesignerService(null)} onLoad={onLoadBlueprint} onSave={onSaveBlueprint} saving={saving} /> : null}
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

function ServiceDesignerModal({ visible, service, onClose, onLoad, onSave, saving }: { visible: boolean; service: JobType; onClose: () => void; onLoad: (jobTypeId: string) => Promise<ServiceBlueprint | null>; onSave: (jobTypeId: string, blueprint: ServiceBlueprint) => Promise<boolean>; saving: boolean }) {
  const [draft, setDraft] = useState<ServiceBlueprint>(emptyBlueprint());
  const [rulesText, setRulesText] = useState("[]");
  const [measuresText, setMeasuresText] = useState("[]");
  const [designerError, setDesignerError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    void onLoad(service.id).then((next) => {
      const blueprint = next ?? emptyBlueprint();
      setDraft({ ...blueprint, fields: blueprint.fields ?? [], items: blueprint.items ?? [], rules: blueprint.rules ?? [], measures: blueprint.measures ?? [] });
      setRulesText(JSON.stringify(blueprint.rules ?? [], null, 2));
      setMeasuresText(JSON.stringify(blueprint.measures ?? [], null, 2));
    });
  }, [visible, service.id, onLoad]);

  const updateField = (index: number, patch: Partial<BlueprintField>) => setDraft({ ...draft, fields: draft.fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field) });
  const updateItem = (index: number, patch: Partial<BlueprintItem>) => setDraft({ ...draft, items: draft.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  const addField = () => setDraft({ ...draft, fields: [...draft.fields, { key: `field_${draft.fields.length + 1}`, label: "Nueva pregunta", type: "text", required: true, options: [] }] });
  const addItem = () => setDraft({ ...draft, items: [...draft.items, { sku: `item_${draft.items.length + 1}`, name: "Nuevo concepto", unit: "unit", currency: "EUR", metadata: {} }] });
  const save = async () => {
    try {
      const rules = JSON.parse(rulesText) as BlueprintRule[];
      const measures = JSON.parse(measuresText) as Array<{ code: string; expression: Record<string, unknown> }>;
      if (!Array.isArray(rules) || !Array.isArray(measures)) throw new Error("Las reglas deben ser listas JSON");
      if (await onSave(service.id, { ...draft, rules, measures })) onClose();
      setDesignerError(null);
    } catch (error) {
      setDesignerError(error instanceof Error ? error.message : "JSON de reglas no válido");
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.designerCard}>
          <View style={styles.modalHeader}><View><Text style={styles.panelTitle}>Diseñar servicio</Text><Text style={styles.listMeta}>{service.name}</Text></View><Pressable onPress={onClose}><Text style={styles.modalClose}>×</Text></Pressable></View>
          <ScrollView style={styles.designerScroll}>
            <Text style={styles.sectionLabel}>Plantilla inicial</Text>
            <Text style={styles.listMeta}>Carga una estructura orientativa y personalízala para este negocio.</Text>
            <View style={styles.templateChoices}>
              <Pressable style={styles.smallButton} onPress={() => setDraftFromTemplate("print", setDraft, setRulesText, setMeasuresText)}><Text style={styles.smallButtonLabel}>Imprenta</Text></Pressable>
              <Pressable style={styles.smallButton} onPress={() => setDraftFromTemplate("renovation", setDraft, setRulesText, setMeasuresText)}><Text style={styles.smallButtonLabel}>Reformas</Text></Pressable>
              <Pressable style={styles.smallButton} onPress={() => setDraftFromTemplate("mechanic", setDraft, setRulesText, setMeasuresText)}><Text style={styles.smallButtonLabel}>Taller</Text></Pressable>
            </View>
            <Text style={styles.sectionLabel}>Preguntas y variables</Text>
            {draft.fields.map((field, index) => <View style={styles.designerRow} key={`${field.key}-${index}`}><Field label="Código" value={field.key} onChangeText={(key) => updateField(index, { key })} /><Field label="Pregunta" value={field.label} onChangeText={(label) => updateField(index, { label })} /><Field label="Tipo" value={field.type} onChangeText={(type) => updateField(index, { type })} /><Toggle label="Obligatoria" value={field.required} onPress={() => updateField(index, { required: !field.required })} /></View>)}
            <Pressable style={styles.secondaryButton} onPress={addField}><Text style={styles.secondaryLabel}>Añadir pregunta</Text></Pressable>
            <Text style={styles.sectionLabel}>Catálogo y conceptos facturables</Text>
            {draft.items.map((item, index) => <View style={styles.designerRow} key={`${item.sku}-${index}`}><Field label="SKU" value={item.sku} onChangeText={(sku) => updateItem(index, { sku })} /><Field label="Concepto" value={item.name} onChangeText={(name) => updateItem(index, { name })} /><Field label="Precio base" value={item.base_price === undefined ? "" : String(item.base_price)} keyboardType="decimal-pad" onChangeText={(value) => updateItem(index, { base_price: value ? Number(value.replace(",", ".")) : undefined })} /></View>)}
            <Pressable style={styles.secondaryButton} onPress={addItem}><Text style={styles.secondaryLabel}>Añadir concepto</Text></Pressable>
            <Text style={styles.sectionLabel}>Reglas deterministas (JSON)</Text>
            <Text style={styles.listMeta}>El LLM propone datos; estas reglas son las que podrán calcular el importe.</Text>
            <TextInput style={[styles.input, styles.textArea, styles.codeInput]} value={rulesText} onChangeText={setRulesText} multiline />
            <Text style={styles.sectionLabel}>Medidas calculadas (JSON)</Text>
            <TextInput style={[styles.input, styles.textArea, styles.codeInput]} value={measuresText} onChangeText={setMeasuresText} multiline />
            {designerError ? <Text style={styles.error}>{designerError}</Text> : null}
          </ScrollView>
          <View style={styles.wizardActions}><Pressable style={styles.secondaryButton} onPress={onClose}><Text style={styles.secondaryLabel}>Cancelar</Text></Pressable><Pressable style={styles.primaryButton} onPress={() => void save()} disabled={saving}><Text style={styles.primaryLabel}>{saving ? "Guardando…" : "Guardar patrón"}</Text></Pressable></View>
        </View>
      </View>
    </Modal>
  );
}

function emptyBlueprint(): ServiceBlueprint {
  return { fields: [], items: [], rules: [], measures: [] };
}

function setDraftFromTemplate(template: "print" | "renovation" | "mechanic", setDraft: (blueprint: ServiceBlueprint) => void, setRulesText: (value: string) => void, setMeasuresText: (value: string) => void) {
  const blueprint = blueprintFor(template);
  setDraft(blueprint);
  setRulesText(JSON.stringify(blueprint.rules, null, 2));
  setMeasuresText(JSON.stringify(blueprint.measures, null, 2));
}

function blueprintFor(template: "print" | "renovation" | "mechanic"): ServiceBlueprint {
  if (template === "renovation") return {
    fields: [
      { key: "room", label: "Estancia a reformar", type: "choice", required: true, options: ["baño", "cocina", "salón"], unit: undefined },
      { key: "surface_m2", label: "Superficie", type: "number", required: true, options: [], unit: "m²", min: 1 },
      { key: "tile", label: "Baldosa", type: "choice", required: true, options: ["blanca mate de gres", "porcelánico", "otro"] },
      { key: "faucet", label: "¿Incluye grifería?", type: "boolean", required: true, options: [] },
      { key: "labor_hours", label: "Horas de mano de obra", type: "number", required: true, options: [], unit: "h", min: 0 }
    ],
    items: [
      { sku: "tile-m2", name: "Baldosa por m²", unit: "m²", base_price: 22, currency: "EUR", metadata: { category: "material" } },
      { sku: "labor-hour", name: "Hora de mano de obra", unit: "hour", base_price: 35, currency: "EUR", metadata: { category: "labor" } }
    ],
    rules: [
      { code: "tile_by_surface", kind: "formula", priority: 10, definition: { quantity: "surface_m2", item: "tile-m2" } },
      { code: "labor_by_hours", kind: "formula", priority: 20, definition: { quantity: "labor_hours", item: "labor-hour" } }
    ],
    measures: []
  };
  if (template === "mechanic") return {
    fields: [
      { key: "operation", label: "Operación", type: "choice", required: true, options: ["mantenimiento", "reparación", "sustitución"] },
      { key: "part", label: "Pieza o material", type: "text", required: true, options: [] },
      { key: "labor_hours", label: "Horas de mano de obra", type: "number", required: true, options: [], unit: "h", min: 0 },
      { key: "repair_photo", label: "Fotografía de la avería", type: "file", required: false, options: [] }
    ],
    items: [{ sku: "labor-hour", name: "Hora de mano de obra", unit: "hour", base_price: 45, currency: "EUR", metadata: { category: "labor" } }],
    rules: [{ code: "labor_by_hours", kind: "formula", priority: 10, definition: { quantity: "labor_hours", item: "labor-hour" } }],
    measures: []
  };
  return {
    fields: [
      { key: "bag_type", label: "Tipo de bolsa", type: "choice", required: true, options: ["tote bag", "mochila", "saco" ] },
      { key: "material", label: "Material", type: "choice", required: true, options: ["algodón", "yute", "poliéster"] },
      { key: "quantity", label: "Unidades", type: "number", required: true, options: [], unit: "ud", min: 250 },
      { key: "size", label: "Talla", type: "choice", required: true, options: ["S", "M", "L"] },
      { key: "base_color", label: "Color de base", type: "text", required: true, options: [] },
      { key: "print_type", label: "Tipo de impresión", type: "choice", required: true, options: ["digital", "serigrafía 2 colores", "serigrafía 4 colores"] },
      { key: "artwork_provided", label: "¿Aporta el diseño?", type: "boolean", required: true, options: [] }
    ],
    items: [
      { sku: "bag-cotton", name: "Bolsa de algodón", unit: "unit", base_price: 4.5, currency: "EUR", metadata: { category: "producto", material: "algodón" } },
      { sku: "print-digital", name: "Impresión digital", unit: "unit", base_price: 1.8, currency: "EUR", metadata: { category: "impresión" } },
      { sku: "artwork-setup", name: "Preparación de diseño", unit: "job", base_price: 35, currency: "EUR", metadata: { category: "diseño" } }
    ],
    rules: [
      { code: "minimum_quantity", kind: "minimum", priority: 1, definition: { field: "quantity", minimum: 250 } },
      { code: "digital_print", kind: "formula", priority: 10, definition: { when: { print_type: "digital" }, item: "print-digital", quantity: "quantity" } },
      { code: "artwork_setup", kind: "surcharge", priority: 20, definition: { when: { artwork_provided: false }, item: "artwork-setup", quantity: 1 } },
      { code: "volume_discount", kind: "factor", priority: 30, definition: { field: "quantity", tiers: [{ gte: 1000, factor: 0.85 }, { gte: 500, factor: 0.92 }] } }
    ],
    measures: []
  };
}

function Field({ label, value, onChangeText, keyboardType, multiline = false }: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: "default" | "decimal-pad" | "number-pad"; multiline?: boolean }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput style={[styles.input, multiline && styles.textArea]} value={value} onChangeText={onChangeText} keyboardType={keyboardType} multiline={multiline} textAlignVertical={multiline ? "top" : "center"} /></View>;
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
  serviceSummaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  smallButton: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7, marginTop: 8 },
  smallButtonLabel: { color: "#285246", fontSize: 12, fontWeight: "700" },
  knowledgeBox: { backgroundColor: "#f7f9fc", borderRadius: 10, padding: 16, marginTop: 18 },
  knowledgeCount: { color: "#61736a", fontSize: 12, lineHeight: 18, marginTop: 14 },
  secondaryButton: { alignSelf: "flex-start", borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 11, marginTop: 16 },
  secondaryLabel: { color: "#285246", fontSize: 14, fontWeight: "600" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(23, 51, 45, 0.36)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 620, backgroundColor: "#ffffff", borderRadius: 16, padding: 24, shadowColor: "#000000", shadowOpacity: 0.15, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  designerCard: { width: "100%", maxWidth: 1100, maxHeight: "92%", backgroundColor: "#ffffff", borderRadius: 16, padding: 24, shadowColor: "#000000", shadowOpacity: 0.15, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  designerScroll: { maxHeight: 620 },
  designerRow: { flexDirection: "row", gap: 10, alignItems: "flex-end", borderTopWidth: 1, borderTopColor: "#edf1ee", paddingTop: 12, marginTop: 8 },
  templateChoices: { flexDirection: "row", gap: 10, marginBottom: 10 },
  codeInput: { fontFamily: "monospace", fontSize: 12 },
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
  sectionLabel: { color: "#17332d", fontSize: 14, fontWeight: "800", marginTop: 10, marginBottom: 10 },
  readonly: { color: "#17332d", fontSize: 16, paddingBottom: 18 },
  formGrid: { flexDirection: "row", gap: 14 },
  input: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11, color: "#17332d", backgroundColor: "#fbfcfb" },
  textArea: { minHeight: 92 },
  documentChoices: { flexDirection: "row", gap: 10 },
  documentChoice: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  documentChoiceActive: { borderColor: "#258269", backgroundColor: "#e8f4ed" },
  documentChoiceLabel: { color: "#285246", fontSize: 13, fontWeight: "600" },
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
