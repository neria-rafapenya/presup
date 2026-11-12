import { StatusBar } from "expo-status-bar";
import { createElement, type ReactNode, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type Screen = "wizard" | "dashboard" | "company" | "services" | "knowledge" | "designer" | "requests" | "quotes";

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
type BlueprintField = { key: string; label: string; type: string; required: boolean; options: string[]; unit?: string; min?: number; max?: number; help_text?: string; example?: string };
type BlueprintItem = { sku: string; name: string; description?: string; unit: string; base_price?: number; currency: string; metadata: Record<string, unknown> };
type CatalogAttribute = { label: string; value: string };
type BlueprintRule = { code: string; kind: string; priority: number; definition: Record<string, unknown> };
type ServiceBlueprint = { version?: number; fields: BlueprintField[]; items: BlueprintItem[]; rules: BlueprintRule[]; measures: Array<{ code: string; expression: Record<string, unknown> }> };
type ServiceTemplate = "print" | "renovation" | "mechanic" | "catering" | "cleaning" | "gardening" | "photography" | "transport" | "it_support" | "consulting" | "training" | "maintenance";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";
const WIZARD_STORAGE_KEY = "horekia.backoffice.onboarding.completed";

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function formatPriceInput(value: number | string | undefined): string {
  if (value === undefined || value === null || value === "") return "";
  const numericValue = Number(String(value).replace(",", "."));
  if (!Number.isFinite(numericValue)) return "";
  return numericValue.toLocaleString("es-ES", { useGrouping: false, maximumFractionDigits: 2 });
}

function parsePriceInput(value: string): number | undefined {
  const normalizedValue = value.replace(",", ".").trim();
  if (!normalizedValue) return undefined;
  const numericValue = Number(normalizedValue);
  return Number.isFinite(numericValue) ? numericValue : undefined;
}

function internalKey(value: string, occupied: string[] = []) {
  let base = slugify(value).replace(/-/g, "_");
  if (!/^[a-z]/.test(base)) base = `campo_${base}`;
  if (base.length < 2) base = "campo";
  base = base.slice(0, 64);
  let candidate = base;
  let suffix = 2;
  while (occupied.includes(candidate)) {
    const suffixText = `_${suffix}`;
    candidate = `${base.slice(0, 64 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  return candidate;
}

function isWizardCompleted() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(WIZARD_STORAGE_KEY) === "true";
}

type AppRoute = { screen: Screen; serviceId?: string };

function routeFromPath(pathname: string): AppRoute | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const designerMatch = path.match(/^\/services\/([^/]+)\/design$/);
  if (designerMatch) return { screen: "designer", serviceId: decodeURIComponent(designerMatch[1]) };
  if (path === "/wizard") return { screen: "wizard" };
  if (path === "/dashboard") return { screen: "dashboard" };
  if (path === "/company") return { screen: "company" };
  if (path === "/services") return { screen: "services" };
  if (path === "/knowledge") return { screen: "knowledge" };
  if (path === "/designer") return { screen: "designer" };
  if (path === "/requests") return { screen: "requests" };
  if (path === "/quotes") return { screen: "quotes" };
  if (path === "/") return { screen: isWizardCompleted() ? "dashboard" : "wizard" };
  return null;
}

function routePath(screen: Screen, serviceId?: string): string {
  if (screen === "designer" && serviceId) return `/services/${encodeURIComponent(serviceId)}/design`;
  if (screen === "designer") return "/designer";
  return `/${screen}`;
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
  const [screen, setScreen] = useState<Screen>(() => routeFromPath(typeof window === "undefined" ? "/" : window.location.pathname)?.screen ?? (isWizardCompleted() ? "dashboard" : "wizard"));
  const [designerRouteServiceId, setDesignerRouteServiceId] = useState<string | null>(() => routeFromPath(typeof window === "undefined" ? "/" : window.location.pathname)?.serviceId ?? null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [profile, setProfile] = useState<TenantProfile | null>(null);
  const [services, setServices] = useState<JobType[]>([]);
  const [designerService, setDesignerService] = useState<JobType | null>(null);
  const [designerReturnScreen, setDesignerReturnScreen] = useState<Screen>("services");
  const [wizardResumeStep, setWizardResumeStep] = useState(0);
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

  useEffect(() => {
    if (screen === "designer" && designerRouteServiceId && services.length) {
      setDesignerService(services.find((service) => service.id === designerRouteServiceId) ?? null);
    }
  }, [screen, designerRouteServiceId, services]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextPath = routePath(screen, designerService?.id ?? designerRouteServiceId ?? undefined);
    if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
  }, [screen, designerService, designerRouteServiceId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => {
      const nextRoute = routeFromPath(window.location.pathname);
      if (!nextRoute) return;
      setScreen(nextRoute.screen);
      setDesignerRouteServiceId(nextRoute.serviceId ?? null);
      if (nextRoute.screen !== "designer") setDesignerService(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
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
      const created = await api<JobType>("/api/v1/backoffice/job-types", {
        method: "POST",
        body: JSON.stringify(newService),
      });
      setServices((current) => current.some((service) => service.id === created.id) ? current.map((service) => service.id === created.id ? created : service) : [...current, created].sort((left, right) => left.name.localeCompare(right.name)));
      setSummary((current) => current ? { ...current, counts: { ...current.counts, job_types: current.counts.job_types + 1 } } : current);
      await load();
      return true;
    } catch {
      setError("No se ha podido crear el servicio. Revisa que el slug no esté repetido.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const deleteService = async (jobTypeId: string) => {
    setSaving(true);
    setError(null);
    try {
      await api<{ id: string }>(`/api/v1/backoffice/job-types/${jobTypeId}`, { method: "DELETE" });
      setServices((current) => current.filter((service) => service.id !== jobTypeId));
      setSummary((current) => current ? { ...current, counts: { ...current.counts, job_types: Math.max(0, current.counts.job_types - 1) } } : current);
      await load();
      return true;
    } catch {
      setError("No se ha podido eliminar el servicio.");
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

  const navigate = (nextScreen: Screen, serviceId?: string) => {
    setScreen(nextScreen);
    setDesignerRouteServiceId(nextScreen === "designer" ? serviceId ?? null : null);
    if (nextScreen !== "designer") setDesignerService(null);
  };

  const openDesigner = (service: JobType, returnScreen: Screen) => {
    setDesignerReturnScreen(returnScreen);
    setWizardResumeStep(returnScreen === "wizard" ? 1 : 0);
    setDesignerService(service);
    navigate("designer", service.id);
  };
  const closeDesigner = () => {
    setDesignerService(null);
    navigate(designerReturnScreen === "designer" ? "services" : designerReturnScreen);
  };

  return (
    <View style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.sidebar}>
        <Text style={styles.brand}>HOREKIA</Text>
        <Text style={styles.brandSub}>BACKOFFICE</Text>
        <View style={styles.nav}>
          <NavButton label="Wizard" active={screen === "wizard"} onPress={() => { setWizardResumeStep(0); navigate("wizard"); }} />
          <NavButton label="Resumen" active={screen === "dashboard"} onPress={() => navigate("dashboard")} />
          <NavButton label="Empresa" active={screen === "company"} onPress={() => navigate("company")} />
          <NavButton label="Servicios y fichas" active={screen === "services" || screen === "designer" || screen === "knowledge"} onPress={() => navigate("services")} />
          <View style={styles.subnav}>
            <NavButton label="Diseñador de servicios" child active={screen === "designer"} onPress={() => { setDesignerReturnScreen("services"); navigate("designer", designerService?.id ?? undefined); }} />
            <NavButton label="Base de conocimiento" child active={screen === "knowledge"} onPress={() => navigate("knowledge")} />
          </View>
          <NavButton label="Peticiones" active={screen === "requests"} onPress={() => navigate("requests")} />
          <NavButton label="Presupuestos" active={screen === "quotes"} onPress={() => navigate("quotes")} />
        </View>
        <View style={styles.sidebarBottom}>
          <Text style={styles.sidebarHint}>Instalación POC</Text>
          <Text style={styles.sidebarMuted}>{summary?.tenant.name ?? "Cargando empresa…"}</Text>
        </View>
      </View>

      {screen === "designer" ? (
        <View style={styles.designerWorkspace}>
          {designerService ? <ServiceDesignerModal visible service={designerService} onClose={closeDesigner} onLoad={loadBlueprint} onSave={saveBlueprint} saving={saving} fullScreen /> : <DesignerServicePicker services={services} onDesign={(service) => openDesigner(service, "services")} onOpenServices={() => navigate("services")} />}
        </View>
      ) : (
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
                <Wizard summary={summary} profile={profile} setProfile={setProfile} services={services} knowledgeSummary={knowledgeSummary} knowledgeEntries={knowledgeEntries} initialStep={wizardResumeStep} onComplete={() => navigate("dashboard")} onSaveProfile={saveProfile} onUploadTemplate={uploadTemplate} onCreateService={createService} onDeleteService={deleteService} onDesignService={(service) => openDesigner(service, "wizard")} onImportKnowledge={importKnowledge} saving={saving} />
              ) : null}
              {screen === "dashboard" ? <Dashboard summary={summary} /> : null}
              {screen === "company" ? (
                <Company summary={summary} setSummary={setSummary} profile={profile} setProfile={setProfile} onSaveProfile={saveProfile} onUploadTemplate={uploadTemplate} onSave={saveSettings} saving={saving} />
              ) : null}
              {screen === "services" ? (
                <Services services={services} onCreate={createService} onDelete={deleteService} onDesignService={(service) => openDesigner(service, "services")} saving={saving} />
              ) : null}
              {screen === "knowledge" ? (
                <KnowledgePage knowledgeSummary={knowledgeSummary} knowledgeEntries={knowledgeEntries} onImport={importKnowledge} saving={saving} />
              ) : null}
              {screen === "requests" ? <ModulePlaceholder title="Peticiones" text="La bandeja de peticiones será el siguiente incremento del backoffice." /> : null}
              {screen === "quotes" ? <ModulePlaceholder title="Presupuestos" text="El motor determinista y la revisión de presupuestos se incorporarán después." /> : null}
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function NavButton({ label, active, onPress, child = false }: { label: string; active: boolean; onPress: () => void; child?: boolean }) {
  return <Pressable style={[styles.navButton, child && styles.navButtonChild, active && styles.navButtonActive]} onPress={onPress}><Text style={[styles.navLabel, child && styles.navLabelChild, active && styles.navLabelActive]}>{label}</Text></Pressable>;
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

function Wizard({ summary, profile, setProfile, services, knowledgeSummary, knowledgeEntries, initialStep = 0, onComplete, onSaveProfile, onUploadTemplate, onCreateService, onDeleteService, onDesignService, onImportKnowledge, saving }: { summary: Summary; profile: TenantProfile; setProfile: (profile: TenantProfile) => void; services: JobType[]; knowledgeSummary: KnowledgeSummary; knowledgeEntries: KnowledgeEntry[]; initialStep?: number; onComplete: () => void; onSaveProfile: (profile: TenantProfile) => Promise<boolean>; onUploadTemplate: (file: File) => Promise<boolean>; onCreateService: (service: NewService) => Promise<boolean>; onDeleteService: (jobTypeId: string) => Promise<boolean>; onDesignService: (service: JobType) => void; onImportKnowledge: (sourceName: string, rows: KnowledgeRow[]) => Promise<boolean>; saving: boolean }) {
  const [step, setStep] = useState(initialStep);
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
          <Company summary={summary} profile={profile} setProfile={setProfile} onSaveProfile={onSaveProfile} onUploadTemplate={onUploadTemplate} saving={saving} embedded />
        ) : null}
        {step === 1 ? (
          <Services services={services} onCreate={onCreateService} onDelete={onDeleteService} onDesignService={onDesignService} saving={saving} embedded />
        ) : null}
        {step === 2 ? (
          <KnowledgePage knowledgeSummary={knowledgeSummary} knowledgeEntries={knowledgeEntries} onImport={onImportKnowledge} saving={saving} embedded />
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
    </View>
  );
}

type KnowledgeImportProps = { knowledgeSummary: KnowledgeSummary; knowledgeEntries: KnowledgeEntry[]; onImport: (sourceName: string, rows: KnowledgeRow[]) => Promise<boolean>; saving: boolean };

function KnowledgePage({ knowledgeSummary, knowledgeEntries, onImport, saving, embedded = false }: KnowledgeImportProps & { embedded?: boolean }) {
  const content = <KnowledgeImport knowledgeSummary={knowledgeSummary} knowledgeEntries={knowledgeEntries} onImport={onImport} saving={saving} />;
  if (embedded) return <View><Text style={styles.panelTitle}>3. Base de conocimiento</Text><Text style={styles.wizardText}>Carga productos, categorías, patrones de venta, políticas o documentación. Gemini podrá consultarlos como contexto; los precios que generen presupuestos seguirán siendo deterministas.</Text>{content}</View>;
  return <View><View style={styles.panel}><Text style={styles.panelTitle}>Base de conocimiento</Text><Text style={styles.wizardText}>Carga productos, categorías, patrones de venta, políticas o documentación. Gemini podrá consultarlos como contexto; los precios que generen presupuestos seguirán siendo deterministas.</Text>{content}</View></View>;
}

function KnowledgeImport({ knowledgeSummary, knowledgeEntries, onImport, saving }: KnowledgeImportProps) {
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

function Company({ summary, setSummary, profile, setProfile, onSaveProfile, onUploadTemplate, onSave, saving, embedded = false }: { summary: Summary; setSummary?: (summary: Summary) => void; profile: TenantProfile; setProfile: (profile: TenantProfile) => void; onSaveProfile: (profile: TenantProfile) => Promise<boolean>; onUploadTemplate: (file: File) => Promise<boolean>; onSave?: () => void; saving: boolean; embedded?: boolean }) {
  const update = (patch: Partial<Summary["settings"]>) => {
    if (setSummary) setSummary({ ...summary, settings: { ...summary.settings, ...patch } });
  };
  return (
    <View>
      {!embedded ? <View style={styles.panel}><Text style={styles.panelTitle}>Datos de empresa</Text><TenantProfileForm profile={profile} setProfile={setProfile} onSave={onSaveProfile} onUploadTemplate={onUploadTemplate} saving={saving} fallbackName={summary.tenant.name} /></View> : <><Text style={styles.panelTitle}>1. Datos de empresa</Text><TenantProfileForm profile={profile} setProfile={setProfile} onSave={onSaveProfile} onUploadTemplate={onUploadTemplate} saving={saving} fallbackName={summary.tenant.name} /></>}
      {!embedded && setSummary && onSave ? <View style={styles.panel}>
        <Text style={styles.panelTitle}>Configuración de operación</Text>
        <Text style={styles.fieldLabel}>Nombre de la instalación</Text>
        <Text style={styles.readonly}>{summary.tenant.name}</Text>
        <View style={styles.formGrid}>
          <Field label="Moneda" value={summary.settings.currency} onChangeText={(currency) => update({ currency })} />
          <Field label="IVA (%)" value={String(summary.settings.tax_rate)} keyboardType="decimal-pad" onChangeText={(tax_rate) => update({ tax_rate })} />
          <Field label="Validez (días)" value={String(summary.settings.quote_validity_days)} keyboardType="number-pad" onChangeText={(value) => update({ quote_validity_days: Number(value) || 0 })} />
        </View>
        <Toggle label="Revisión humana obligatoria" value={summary.settings.review_required} onPress={() => update({ review_required: !summary.settings.review_required })} />
        <Toggle label="Chat público habilitado" value={summary.settings.public_chat_enabled} onPress={() => update({ public_chat_enabled: !summary.settings.public_chat_enabled })} />
        <Pressable style={styles.primaryButton} onPress={onSave} disabled={saving}><Text style={styles.primaryLabel}>{saving ? "Guardando…" : "Guardar configuración"}</Text></Pressable>
      </View> : null}
    </View>
  );
}

function Services({ services, onCreate, onDelete, onDesignService, saving, embedded = false }: { services: JobType[]; onCreate: (service: NewService) => Promise<boolean>; onDelete: (jobTypeId: string) => Promise<boolean>; onDesignService: (service: JobType) => void; saving: boolean; embedded?: boolean }) {
  const [modalVisible, setModalVisible] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState<JobType | null>(null);
  return (
    <View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Servicios y fichas</Text>
        <Text style={styles.wizardText}>Los servicios definen las líneas de negocio que el tenant puede presupuestar.</Text>
        <TutorialVideo />
        <Pressable style={styles.primaryButton} onPress={() => setModalVisible(true)} disabled={saving}><Text style={styles.primaryLabel}>Nuevo servicio</Text></Pressable>
      </View>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Servicios configurados</Text>
        {services.map((service) => <View style={styles.listRow} key={service.id}><View><Text style={styles.listTitle}>{service.name}</Text><Text style={styles.listMeta}>{service.slug} · {service.status}</Text></View><View style={styles.serviceActions}><Pressable style={styles.smallButton} onPress={() => onDesignService(service)}><Text style={styles.smallButtonLabel}>Diseñar</Text></Pressable><Pressable style={styles.deleteButton} onPress={() => setServiceToDelete(service)}><Text style={styles.deleteLabel}>Eliminar</Text></Pressable></View></View>)}
      </View>
      <ServiceModal visible={modalVisible} services={services} onClose={() => setModalVisible(false)} onCreate={onCreate} saving={saving} />
      <DeleteServiceModal service={serviceToDelete} onClose={() => setServiceToDelete(null)} onConfirm={async () => { if (serviceToDelete && await onDelete(serviceToDelete.id)) setServiceToDelete(null); }} saving={saving} />
    </View>
  );
}

function DesignerServicePicker({ services, onDesign, onOpenServices }: { services: JobType[]; onDesign: (service: JobType) => void; onOpenServices: () => void }) {
  return <View style={styles.designerPicker}><View style={styles.designerWorkspaceHeader}><View><Text style={styles.kicker}>CONFIGURACIÓN</Text><Text style={styles.workspaceTitle}>Diseñador de servicios</Text><Text style={styles.workspaceText}>Selecciona un servicio para editar sus preguntas, catálogo, reglas y medidas calculadas.</Text></View><Pressable style={styles.secondaryButton} onPress={onOpenServices}><Text style={styles.secondaryLabel}>Gestionar servicios</Text></Pressable></View><View style={styles.panel}><Text style={styles.panelTitle}>Selecciona un servicio</Text>{services.length ? services.map((service) => <View style={styles.listRow} key={service.id}><View><Text style={styles.listTitle}>{service.name}</Text><Text style={styles.listMeta}>{service.slug} · {service.status}</Text></View><Pressable style={styles.primaryButton} onPress={() => onDesign(service)}><Text style={styles.primaryLabel}>Diseñar</Text></Pressable></View>) : <Text style={styles.emptyText}>Todavía no hay servicios. Crea uno desde «Servicios y fichas».</Text>}</View></View>;
}

function TutorialVideo() {
  if (Platform.OS !== "web") return <Text style={styles.listMeta}>El tutorial visual está disponible en la versión web del backoffice.</Text>;
  return <View style={styles.tutorialBox}><Text style={styles.tutorialTitle}>¿Cómo crear un servicio?</Text><Text style={styles.listMeta}>Mira este ejemplo de catering y adapta los pasos a tu negocio.</Text>{createElement("video", { controls: true, playsInline: true, preload: "metadata", src: "/tutorial-crear-servicio-catering.mp4?v=5", style: styles.tutorialVideo, "aria-label": "Tutorial visual para crear un servicio de catering" })}</View>;
}

function DeleteServiceModal({ service, onClose, onConfirm, saving }: { service: JobType | null; onClose: () => void; onConfirm: () => Promise<void>; saving: boolean }) {
  return <Modal visible={Boolean(service)} transparent animationType="fade" onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.confirmCard}><View style={styles.modalHeader}><Text style={styles.panelTitle}>Eliminar servicio</Text><Pressable onPress={onClose} disabled={saving}><Text style={styles.modalClose}>×</Text></Pressable></View><Text style={styles.confirmTitle}>{service?.name}</Text><Text style={styles.wizardText}>Se eliminará este servicio y su configuración de preguntas, catálogo y reglas. Las peticiones o presupuestos históricos conservarán sus referencias sin este servicio.</Text><Text style={styles.confirmWarning}>Esta acción no se puede deshacer.</Text><View style={styles.wizardActions}><Pressable style={styles.secondaryButton} onPress={onClose} disabled={saving}><Text style={styles.secondaryLabel}>Cancelar</Text></Pressable><Pressable style={styles.dangerButton} onPress={() => void onConfirm()} disabled={saving}><Text style={styles.primaryLabel}>{saving ? "Eliminando…" : "Sí, eliminar"}</Text></Pressable></View></View></View></Modal>;
}

function ServiceModal({ visible, services, onClose, onCreate, saving }: { visible: boolean; services: JobType[]; onClose: () => void; onCreate: (service: NewService) => Promise<boolean>; saving: boolean }) {
  const [draft, setDraft] = useState<NewService>({ slug: "", name: "", description: "" });
  const [validationError, setValidationError] = useState<string | null>(null);
  const slugExists = Boolean(draft.slug) && services.some((service) => service.slug === draft.slug);
  const submit = async () => {
    if (!draft.name.trim()) {
      setValidationError("Escribe un nombre para el servicio.");
      return;
    }
    if (slugExists) {
      setValidationError("Ya existe otro servicio con este nombre. Cambia el nombre para generar un slug distinto.");
      return;
    }
    if (await onCreate(draft)) {
      setDraft({ slug: "", name: "", description: "" });
      setValidationError(null);
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
            <Field label="Nombre" hint="Es el nombre visible del producto o servicio que quieres presupuestar." value={draft.name} onChangeText={(name) => { const slug = slugify(name); setDraft({ ...draft, name, slug }); setValidationError(services.some((service) => service.slug === slug) ? "Ya existe otro servicio con este nombre. Cambia el nombre para generar un slug distinto." : null); }} />
            <Field label="Slug automático" hint="Identificador interno creado automáticamente a partir del nombre." value={draft.slug} editable={false} onChangeText={() => undefined} />
          </View>
          <Field label="Descripción" value={draft.description} onChangeText={(description) => setDraft({ ...draft, description })} />
          {validationError ? <Text style={styles.error}>{validationError}</Text> : null}
          <View style={styles.wizardActions}><Pressable style={styles.secondaryButton} onPress={onClose}><Text style={styles.secondaryLabel}>Cancelar</Text></Pressable><Pressable style={styles.primaryButton} onPress={submit} disabled={saving || !draft.name.trim() || slugExists}><Text style={styles.primaryLabel}>{saving ? "Guardando…" : "Añadir servicio"}</Text></Pressable></View>
        </View>
      </View>
    </Modal>
  );
}

function ServiceDesignerModal({ visible, service, onClose, onLoad, onSave, saving, fullScreen = false }: { visible: boolean; service: JobType; onClose: () => void; onLoad: (jobTypeId: string) => Promise<ServiceBlueprint | null>; onSave: (jobTypeId: string, blueprint: ServiceBlueprint) => Promise<boolean>; saving: boolean; fullScreen?: boolean }) {
  const [draft, setDraft] = useState<ServiceBlueprint>(emptyBlueprint());
  const [ruleCards, setRuleCards] = useState<EditableRule[]>([]);
  const [measuresText, setMeasuresText] = useState("[]");
  const [designerError, setDesignerError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [savingBlockKey, setSavingBlockKey] = useState<string | null>(null);
  const [designerDirty, setDesignerDirty] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [expandedBlockKey, setExpandedBlockKey] = useState<string | null>(null);
  const [designerLoading, setDesignerLoading] = useState(false);
  const [designerSection, setDesignerSection] = useState<DesignerSection>("fields");
  const [designerSearch, setDesignerSearch] = useState("");
  const originalBlueprintRef = useRef<ServiceBlueprint>(emptyBlueprint());
  const [scrollTarget, setScrollTarget] = useState<{ section: "field" | "item" | "rule"; index: number } | null>(null);
  const [highlightTarget, setHighlightTarget] = useState<{ section: "field" | "item" | "rule"; index: number } | null>(null);
  const designerScrollRef = useRef<ScrollView>(null);
  const highlightAnimation = useRef(new Animated.Value(0)).current;
  const fieldPositions = useRef<Record<number, number>>({});
  const itemPositions = useRef<Record<number, number>>({});
  const rulePositions = useRef<Record<number, number>>({});
  const fieldEditorIds = useRef<string[]>([]);
  const nextFieldEditorId = useRef(0);

  const createFieldEditorId = () => `field-editor-${nextFieldEditorId.current++}`;
  const resetFieldEditorIds = (fields: BlueprintField[]) => {
    fieldEditorIds.current = fields.map(() => createFieldEditorId());
  };

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setDesignerLoading(true);
    setSaveMessage(null);
    setSavingBlockKey(null);
    setDesignerError(null);
    setDesignerDirty(false);
    setDiscardConfirmOpen(false);
    setExpandedBlockKey(null);
    setDesignerSection("fields");
    setDesignerSearch("");
    void onLoad(service.id).then((next) => {
      const blueprint = next ?? emptyBlueprint();
      const normalizedBlueprint = { ...blueprint, fields: blueprint.fields ?? [], items: blueprint.items ?? [], rules: blueprint.rules ?? [], measures: blueprint.measures ?? [] };
      originalBlueprintRef.current = cloneBlueprint(normalizedBlueprint);
      setDraft(normalizedBlueprint);
      resetFieldEditorIds(normalizedBlueprint.fields);
      setRuleCards(toEditableRules(normalizedBlueprint.rules));
      setMeasuresText(JSON.stringify(normalizedBlueprint.measures, null, 2));
    }).catch(() => undefined).finally(() => {
      if (active) setDesignerLoading(false);
    });
    return () => {
      active = false;
    };
  // onLoad is recreated by the parent when saving; that must not reload the
  // blueprint or show the initial loading overlay again.
  }, [visible, service.id]);

  useEffect(() => {
    if (!scrollTarget) return;
    const timeout = setTimeout(() => {
      const positions = scrollTarget.section === "field" ? fieldPositions.current : scrollTarget.section === "item" ? itemPositions.current : rulePositions.current;
      const y = positions[scrollTarget.index];
      if (y === undefined) {
        designerScrollRef.current?.scrollToEnd({ animated: true });
      } else {
        designerScrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
      }
      setScrollTarget(null);
    }, 60);
    return () => clearTimeout(timeout);
  }, [draft.fields.length, draft.items.length, ruleCards.length, scrollTarget]);

  const highlightNewBlock = (section: "field" | "item" | "rule", index: number) => {
    setHighlightTarget({ section, index });
    highlightAnimation.stopAnimation();
    highlightAnimation.setValue(1);
    Animated.timing(highlightAnimation, { toValue: 0, duration: 1800, useNativeDriver: false }).start(({ finished }) => {
      if (finished) setHighlightTarget(null);
    });
  };

  const markDesignerDirty = () => { setDesignerDirty(true); setSaveMessage(null); };
  const updateField = (index: number, patch: Partial<BlueprintField>) => { markDesignerDirty(); setDraft({ ...draft, fields: draft.fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field) }); };
  const updateItem = (index: number, patch: Partial<BlueprintItem>) => { markDesignerDirty(); setDraft({ ...draft, items: draft.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }); };
  const updateItemAttributes = (index: number, attributes: CatalogAttribute[]) => { const item = draft.items[index]; updateItem(index, { metadata: { ...item.metadata, attributes } }); };
  const addItemAttribute = (index: number) => { const item = draft.items[index]; updateItemAttributes(index, [...readCatalogAttributes(item), { label: "", value: "" }]); };
  const updateItemAttribute = (index: number, attributeIndex: number, patch: Partial<CatalogAttribute>) => { const item = draft.items[index]; const attributes = readCatalogAttributes(item).map((attribute, currentIndex) => currentIndex === attributeIndex ? { ...attribute, ...patch } : attribute); updateItemAttributes(index, attributes); };
  const removeItemAttribute = (index: number, attributeIndex: number) => { const item = draft.items[index]; updateItemAttributes(index, readCatalogAttributes(item).filter((_, currentIndex) => currentIndex !== attributeIndex)); };
  const updateItemName = (index: number, name: string) => {
    const item = draft.items[index];
    const occupied = draft.items.filter((_, itemIndex) => itemIndex !== index).map((currentItem) => currentItem.sku);
    const automaticSku = item.sku.startsWith("item_") || item.sku === internalKey(item.name, occupied);
    updateItem(index, { name, ...(automaticSku ? { sku: internalKey(name, occupied) } : {}) });
  };
  const updateFieldLabel = (index: number, label: string) => {
    const field = draft.fields[index];
    const occupied = draft.fields.filter((_, fieldIndex) => fieldIndex !== index).map((item) => item.key);
    const generatedFromCurrent = internalKey(field.label, occupied);
    const key = field.key === generatedFromCurrent || field.key.startsWith("field_") ? internalKey(label, occupied) : field.key;
    updateField(index, { label, key });
  };
  const toggleBlock = (blockKey: string) => setExpandedBlockKey((current) => current === blockKey ? null : blockKey);
  const addField = (type = "text", label = "Nueva pregunta") => { markDesignerDirty(); if (fullScreen) selectDesignerSection("fields"); const index = draft.fields.length; const key = internalKey(label, draft.fields.map((field) => field.key)); const editorId = createFieldEditorId(); fieldEditorIds.current = [...fieldEditorIds.current, editorId]; setExpandedBlockKey(`field-${editorId}`); setDraft({ ...draft, fields: [...draft.fields, { key, label, type, required: true, options: [], example: exampleForType(type) }] }); setScrollTarget({ section: "field", index }); highlightNewBlock("field", index); };
  const removeField = (index: number) => { markDesignerDirty(); fieldEditorIds.current = fieldEditorIds.current.filter((_, fieldIndex) => fieldIndex !== index); setDraft({ ...draft, fields: draft.fields.filter((_, fieldIndex) => fieldIndex !== index) }); };
  const moveField = (index: number, direction: -1 | 1) => { const nextIndex = index + direction; if (nextIndex < 0 || nextIndex >= draft.fields.length) return; markDesignerDirty(); const fields = [...draft.fields]; const editorIds = [...fieldEditorIds.current]; [fields[index], fields[nextIndex]] = [fields[nextIndex], fields[index]]; [editorIds[index], editorIds[nextIndex]] = [editorIds[nextIndex], editorIds[index]]; fieldEditorIds.current = editorIds; setDraft({ ...draft, fields }); };
  const loadTemplate = (template: ServiceTemplate) => { markDesignerDirty(); const blueprint = blueprintFor(template); resetFieldEditorIds(blueprint.fields); setDraftFromTemplate(template, setDraft, setRuleCards, setMeasuresText); };
  const resetToOriginal = () => { markDesignerDirty(); const blueprint = cloneBlueprint(originalBlueprintRef.current); resetFieldEditorIds(blueprint.fields); setDraft(blueprint); setRuleCards(toEditableRules(blueprint.rules)); setMeasuresText(JSON.stringify(blueprint.measures, null, 2)); setExpandedBlockKey(null); setDesignerSection("fields"); setDesignerSearch(""); };
  const addItem = (category = "producto") => { markDesignerDirty(); if (fullScreen) selectDesignerSection("items"); const index = draft.items.length; setExpandedBlockKey(`item-${index}`); setDraft({ ...draft, items: [...draft.items, { sku: `item_${index + 1}`, name: `Nuevo ${category}`, unit: "m²", currency: "EUR", metadata: { category } }] }); setScrollTarget({ section: "item", index }); highlightNewBlock("item", index); };
  const removeItem = (index: number) => { markDesignerDirty(); setDraft({ ...draft, items: draft.items.filter((_, itemIndex) => itemIndex !== index) }); };
  const updateRule = (index: number, patch: Partial<EditableRule>) => { markDesignerDirty(); setRuleCards(ruleCards.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule)); };
  const updateRuleReference = (index: number, reference: "field" | "item", value: string) => {
    const rule = ruleCards[index];
    const definition = parseRuleDefinition(rule.definitionText);
    const nextDefinition = { ...definition, [reference]: value };
    if (reference === "field" && rule.kind === "formula") nextDefinition.quantity = value;
    updateRule(index, { definitionText: JSON.stringify(nextDefinition, null, 2) });
  };
  const addRule = (kind: BlueprintRule["kind"]) => { markDesignerDirty(); if (fullScreen) selectDesignerSection("rules"); const index = ruleCards.length; setExpandedBlockKey(`rule-${index}`); setRuleCards([...ruleCards, editableRule({ code: "", kind, priority: (index + 1) * 10, definition: defaultRuleDefinition(kind) })]); setScrollTarget({ section: "rule", index }); highlightNewBlock("rule", index); };
  const removeRule = (index: number) => { markDesignerDirty(); setRuleCards(ruleCards.filter((_, ruleIndex) => ruleIndex !== index)); };
  const save = async (blockKey?: string) => {
    setSavingBlockKey(blockKey ?? null);
    try {
      const rules = ruleCards.map(({ definitionText, ...rule }) => ({ ...rule, definition: JSON.parse(definitionText) }));
      const measures = JSON.parse(measuresText) as Array<{ code: string; expression: Record<string, unknown> }>;
      if (!Array.isArray(rules) || !Array.isArray(measures)) throw new Error("Las reglas deben ser listas JSON");
      const fieldCodes = new Set(draft.fields.map((field) => field.key));
      const itemCodes = new Set(draft.items.map((item) => item.sku));
      const measureCodes = new Set(measures.map((measure) => measure.code));
      rules.forEach((rule) => {
        if (!rule.code.trim()) throw new Error("Cada regla debe tener un código. Ejemplo: floor_material_by_area");
        if (!/^[a-z][a-z0-9_]{1,63}$/.test(rule.code)) throw new Error(`El código de la regla «${rule.code}» debe usar minúsculas, números y guiones bajos.`);
        const definition = rule.definition;
        if (typeof definition.field === "string" && !fieldCodes.has(definition.field)) throw new Error(`La regla «${rule.code}» referencia un campo inexistente: ${definition.field}`);
        if (typeof definition.quantity === "string" && !fieldCodes.has(definition.quantity) && !measureCodes.has(definition.quantity)) throw new Error(`La regla «${rule.code}» referencia una cantidad inexistente: ${definition.quantity}`);
        if (typeof definition.item === "string" && !itemCodes.has(definition.item)) throw new Error(`La regla «${rule.code}» referencia un concepto inexistente: ${definition.item}`);
        if (definition.when && typeof definition.when === "object" && !Array.isArray(definition.when)) {
          Object.keys(definition.when).forEach((fieldCode) => {
            if (!fieldCodes.has(fieldCode)) throw new Error(`La regla «${rule.code}» usa una condición inexistente: ${fieldCode}`);
          });
        }
      });
      const fields = draft.fields.map((field) => ({ ...field, options: field.options.map((option) => option.trim()).filter(Boolean) }));
      const saved = await onSave(service.id, { ...draft, fields, rules, measures });
      if (saved) {
        setDesignerError(null);
        setDesignerDirty(false);
        setSaveMessage(blockKey ? "Elemento guardado. Puedes seguir editándolo." : "Patrón guardado. Puedes seguir editándolo.");
      } else {
        setDesignerError("No se ha podido guardar el patrón. Revisa la conexión con la API e inténtalo de nuevo.");
      }
    } catch (error) {
      setDesignerError(error instanceof Error ? error.message : "JSON de reglas no válido");
    } finally {
      setSavingBlockKey(null);
    }
  };
  const requestClose = () => {
    if (designerDirty) {
      setDiscardConfirmOpen(true);
    } else {
      onClose();
    }
  };
  const discardAndClose = () => {
    setDiscardConfirmOpen(false);
    onClose();
  };

  const selectDesignerSection = (section: DesignerSection) => { setDesignerSection(section); setDesignerSearch(""); };
  const matchesDesignerSearch = (value: string) => !fullScreen || !designerSearch.trim() || value.toLocaleLowerCase().includes(designerSearch.trim().toLocaleLowerCase());

  const designerPanel = (
        <View style={[styles.designerCard, fullScreen && styles.designerFullScreenCard]}>
          <View style={styles.modalHeader}><View><Text style={styles.panelTitle}>Diseñar servicio</Text><Text style={styles.listMeta}>{service.name}</Text></View></View>
          {fullScreen ? <DesignerSectionTabs value={designerSection} onChange={selectDesignerSection} counts={{ fields: draft.fields.length, items: draft.items.length, rules: ruleCards.length, measures: draft.measures.length }} /> : null}
          <ScrollView ref={designerScrollRef} style={[styles.designerScroll, fullScreen && styles.designerFullScreenScroll]}>
            <View style={styles.templateChoices}>
              <TemplateSelector onSelect={loadTemplate} onReset={resetToOriginal} />
            </View>
            <View style={fullScreen && designerSection !== "fields" ? styles.hidden : null}><Text style={styles.sectionLabel}>Preguntas y variables</Text>
            <Text style={styles.listMeta}>Añade un bloque, cambia su nombre y define qué debe saber el chatbot. Las flechas solo cambian el orden en que se preguntará.</Text>
            {fullScreen ? <TextInput style={styles.designerFilterInput} value={designerSearch} onChangeText={setDesignerSearch} placeholder="Filtrar preguntas por nombre o código…" /> : null}
            <View style={styles.blockPalette}>{[["Texto", "text"], ["Número", "number"], ["Opción", "choice"], ["Sí/No", "boolean"], ["Imagen", "file"]].map(([label, type]) => <Pressable style={styles.paletteButton} key={type} onPress={() => addField(type, label)}><Text style={styles.paletteLabel}>＋ {label}</Text></Pressable>)}</View>
            {draft.fields.map((field, index) => <Animated.View onLayout={(event) => { fieldPositions.current[index] = event.nativeEvent.layout.y; }} style={[styles.blockCard, highlightTarget?.section === "field" && highlightTarget.index === index ? { backgroundColor: highlightAnimation.interpolate({ inputRange: [0, 1], outputRange: ["#fbfdfb", "#fff2b8"] }) } : null, fullScreen && !matchesDesignerSearch(`${field.label} ${field.key}`) ? styles.hidden : null]} key={fieldEditorIds.current[index] ?? `field-editor-fallback-${index}`}><View style={styles.blockHeader}><Pressable style={styles.blockToggle} onPress={() => toggleBlock(`field-${fieldEditorIds.current[index]}`)}><Text style={styles.collapseIcon}>{expandedBlockKey === `field-${fieldEditorIds.current[index]}` ? "▲" : "▼"}</Text><Text style={styles.blockIndex}>{index + 1}</Text><Text style={styles.blockTitle}>{field.label || "Pregunta sin título"}</Text></Pressable><Pressable onPress={() => moveField(index, -1)}><Text style={styles.reorderLabel}>↑</Text></Pressable><Pressable onPress={() => moveField(index, 1)}><Text style={styles.reorderLabel}>↓</Text></Pressable><Pressable style={styles.blockSaveButton} onPress={() => void save(`field-${fieldEditorIds.current[index]}`)} disabled={saving}><Text style={styles.blockSaveLabel}>{savingBlockKey === `field-${fieldEditorIds.current[index]}` ? "Guardando…" : "Guardar"}</Text></Pressable><Pressable onPress={() => removeField(index)}><Text style={styles.deleteLabel}>Eliminar</Text></Pressable></View><AnimatedCollapse expanded={expandedBlockKey === `field-${fieldEditorIds.current[index]}`}><View style={styles.designerRow}><Field label="Pregunta para el cliente" hint="Es la frase que verá la persona en el chatbot. Ejemplo: ¿Cuántas unidades necesitas?" value={field.label} onChangeText={(label) => updateFieldLabel(index, label)} /><FieldTypeSelector value={field.type} onChange={(type) => updateField(index, { type })} /></View><View style={styles.designerRow}>{field.type === "choice" ? <Field label="Opciones posibles" hint="Escribe las respuestas válidas separadas por comas. Ejemplo: estándar, urgente, express." value={field.options.join(", ")} onChangeText={(value) => updateField(index, { options: value.split(",").map((option) => option.trim()) })} /> : <View style={styles.field} />}{field.type === "number" ? <Field label="Unidad" hint="Indica qué se está contando. Ejemplo: ud, horas, m² o kg." value={field.unit ?? ""} onChangeText={(unit) => updateField(index, { unit: unit || undefined })} /> : <View style={styles.field} />}<Toggle label="Debe contestarse" hint="Si está activo, el chatbot preguntará por este dato antes de calcular el presupuesto." value={field.required} onPress={() => updateField(index, { required: !field.required })} /></View><View style={styles.designerRow}><Field label="Ejemplo" hint="Un valor ficticio que ayuda a entender qué debe escribir el cliente. No fija la respuesta." value={field.example ?? ""} onChangeText={(example) => updateField(index, { example: example || undefined })} /><Field label="Ayuda adicional" hint="Una explicación breve para aclarar la pregunta. Ejemplo: si no tienes el diseño, indícalo y lo prepara el equipo." value={field.help_text ?? ""} onChangeText={(help_text) => updateField(index, { help_text: help_text || undefined })} /></View>{field.example ? <Text style={styles.exampleHint}>Ejemplo visible: {field.example}</Text> : null}</AnimatedCollapse></Animated.View>)}
            </View><View style={fullScreen && designerSection !== "items" ? styles.hidden : null}><Text style={styles.sectionLabel}>Catálogo y conceptos facturables</Text>
            {fullScreen ? <TextInput style={styles.designerFilterInput} value={designerSearch} onChangeText={setDesignerSearch} placeholder="Filtrar conceptos por nombre o código…" /> : null}
            <View style={styles.blockPalette}>{[["Producto", "producto"], ["Material", "material"], ["Mano de obra", "mano de obra"], ["Extra", "extra"]].map(([label, category]) => <Pressable style={styles.paletteButton} key={category} onPress={() => addItem(category)}><Text style={styles.paletteLabel}>＋ {label}</Text></Pressable>)}</View>
            {draft.items.map((item, index) => <Animated.View onLayout={(event) => { itemPositions.current[index] = event.nativeEvent.layout.y; }} style={[styles.blockCard, highlightTarget?.section === "item" && highlightTarget.index === index ? { backgroundColor: highlightAnimation.interpolate({ inputRange: [0, 1], outputRange: ["#fbfdfb", "#fff2b8"] }) } : null, fullScreen && !matchesDesignerSearch(`${item.name} ${item.sku} ${item.description ?? ""}`) ? styles.hidden : null]} key={`${item.sku}-${index}`}><View style={styles.blockHeader}><Pressable style={styles.blockToggle} onPress={() => toggleBlock(`item-${index}`)}><Text style={styles.collapseIcon}>{expandedBlockKey === `item-${index}` ? "▲" : "▼"}</Text><Text style={styles.blockTitle}>{item.name || "Concepto sin título"}</Text></Pressable><Pressable style={styles.blockSaveButton} onPress={() => void save(`item-${index}`)} disabled={saving}><Text style={styles.blockSaveLabel}>{savingBlockKey === `item-${index}` ? "Guardando…" : "Guardar"}</Text></Pressable><Pressable onPress={() => removeItem(index)}><Text style={styles.deleteLabel}>Eliminar</Text></Pressable></View><AnimatedCollapse expanded={expandedBlockKey === `item-${index}`}><View style={styles.designerRow}><Field label="Concepto" hint="Nombre concreto que aparecerá en el presupuesto. Ejemplo: Baldosa de gres azul 50×50 cm." value={item.name} onChangeText={(name) => updateItemName(index, name)} /></View><Field label="Descripción" hint="Detalles que ayudan a la IA y pueden aparecer en el presupuesto. Ejemplo: acabado mate, apta para suelo de baño." value={item.description ?? ""} onChangeText={(description) => updateItem(index, { description: description || undefined })} multiline /><Text style={styles.fieldLabel}>Atributos del producto</Text><Text style={styles.listMeta}>Añade los datos que diferencian este producto: marca, modelo, color, medidas, acabado, etc.</Text>{readCatalogAttributes(item).map((attribute, attributeIndex) => <View style={styles.designerRow} key={`${index}-attribute-${attributeIndex}`}><Field label="Atributo" value={attribute.label} onChangeText={(label) => updateItemAttribute(index, attributeIndex, { label })} /><Field label="Valor" value={attribute.value} onChangeText={(value) => updateItemAttribute(index, attributeIndex, { value })} /><Pressable onPress={() => removeItemAttribute(index, attributeIndex)}><Text style={styles.deleteLabel}>Eliminar</Text></Pressable></View>)}<Pressable style={styles.smallButton} onPress={() => addItemAttribute(index)}><Text style={styles.smallButtonLabel}>＋ Añadir atributo</Text></Pressable><View style={styles.designerRow}><UnitSelector value={item.unit || "m²"} onChange={(unit) => updateItem(index, { unit })} /><Field label="Precio base" hint="Importe por cada unidad. Se muestra sin ceros innecesarios. Ejemplo: 22 €/m²." value={formatPriceInput(item.base_price)} keyboardType="decimal-pad" onChangeText={(value) => updateItem(index, { base_price: parsePriceInput(value) })} /></View></AnimatedCollapse></Animated.View>)}
            </View><View style={fullScreen && designerSection !== "rules" ? styles.hidden : null}><Text style={styles.sectionLabel}>Reglas deterministas</Text>
            <Text style={styles.listMeta}>El LLM propone datos; estas reglas son las que podrán calcular el importe.</Text>
            {fullScreen ? <TextInput style={styles.designerFilterInput} value={designerSearch} onChangeText={setDesignerSearch} placeholder="Filtrar reglas por código o descripción…" /> : null}
            <View style={styles.blockPalette}>{[["Mínimo", "minimum"], ["Descuento", "factor"], ["Recargo", "surcharge"], ["Fórmula", "formula"]].map(([label, kind]) => <Pressable style={styles.paletteButton} key={kind} onPress={() => addRule(kind as BlueprintRule["kind"])}><Text style={styles.paletteLabel}>＋ {label}</Text></Pressable>)}</View>
            {ruleCards.map((rule, index) => <Animated.View onLayout={(event) => { rulePositions.current[index] = event.nativeEvent.layout.y; }} style={[styles.blockCard, highlightTarget?.section === "rule" && highlightTarget.index === index ? { backgroundColor: highlightAnimation.interpolate({ inputRange: [0, 1], outputRange: ["#fbfdfb", "#fff2b8"] }) } : null, fullScreen && !matchesDesignerSearch(`${rule.code} ${ruleSummary(rule, draft.fields, draft.items)}`) ? styles.hidden : null]} key={`${rule.code}-${index}`}><View style={styles.blockHeader}><Pressable style={styles.blockToggle} onPress={() => toggleBlock(`rule-${index}`)}><Text style={styles.collapseIcon}>{expandedBlockKey === `rule-${index}` ? "▲" : "▼"}</Text><Text style={styles.blockTitle}>{ruleSummary(rule, draft.fields, draft.items)}{rule.code ? ` - [${rule.code}]` : " - [Regla sin código]"}</Text></Pressable><Pressable style={styles.blockSaveButton} onPress={() => void save(`rule-${index}`)} disabled={saving}><Text style={styles.blockSaveLabel}>{savingBlockKey === `rule-${index}` ? "Guardando…" : "Guardar"}</Text></Pressable><Pressable onPress={() => removeRule(index)}><Text style={styles.deleteLabel}>Eliminar</Text></Pressable></View><AnimatedCollapse expanded={expandedBlockKey === `rule-${index}`}><View style={styles.designerRow}><Field label="Código" hint="Identificador de la regla. Usa minúsculas y guiones bajos." placeholder="Ejemplo: floor_material_by_area" value={rule.code} onChangeText={(code) => updateRule(index, { code })} /><Field label="Tipo" value={rule.kind} onChangeText={(kind) => updateRule(index, { kind })} /><Field label="Prioridad" value={String(rule.priority)} keyboardType="number-pad" onChangeText={(value) => updateRule(index, { priority: Number(value) || 0 })} /></View><View style={styles.designerRow}><ReferenceSelector label="Campo de referencia" hint="Escoge la pregunta o variable que aporta la cantidad o condición de esta regla." value={ruleReferenceValue(rule, "field")} options={draft.fields.map((field) => ({ value: field.key, label: field.label }))} onChange={(value) => updateRuleReference(index, "field", value)} /><ReferenceSelector label="Concepto facturable" hint="Escoge el producto, material, mano de obra o extra que aplicará la regla." value={ruleReferenceValue(rule, "item")} options={draft.items.map((item) => ({ value: item.sku, label: item.name }))} onChange={(value) => updateRuleReference(index, "item", value)} /></View><Text style={styles.fieldLabel}>Detalle avanzado de la regla (JSON)</Text><TextInput style={[styles.input, styles.ruleDetailInput]} value={rule.definitionText} onChangeText={(definitionText) => updateRule(index, { definitionText })} multiline /></AnimatedCollapse></Animated.View>)}
            </View><View style={fullScreen && designerSection !== "measures" ? styles.hidden : null}><View style={styles.sectionHeaderRow}><View style={styles.sectionHeaderContent}><Text style={styles.sectionLabel}>Medidas calculadas (JSON)</Text><Text style={styles.listMeta}>Úsalas solo para cantidades intermedias reutilizables, como una superficie con un 10 % de desperdicio. Para una relación directa como superficie × material no necesitas crear una medida.</Text></View></View>
            <TextInput style={[styles.input, styles.textArea, styles.codeInput]} value={measuresText} onChangeText={(value) => { markDesignerDirty(); setMeasuresText(value); }} multiline />
            <View style={styles.measureActions}><Pressable style={styles.blockSaveButton} onPress={() => void save("measures")} disabled={saving}><Text style={styles.blockSaveLabel}>{savingBlockKey === "measures" ? "Guardando…" : "Guardar"}</Text></Pressable></View>
            {designerError ? <Text style={styles.error}>{designerError}</Text> : null}
            {saveMessage ? <Text style={styles.success}>{saveMessage}</Text> : null}</View>
          </ScrollView>
          <View style={styles.wizardActions}><Pressable style={styles.secondaryButton} onPress={requestClose}><Text style={styles.secondaryLabel}>Cerrar</Text></Pressable></View>
          {designerLoading ? <View style={styles.designerLoadingOverlay}><ActivityIndicator size="large" color="#258269" /><Text style={styles.designerLoadingText}>Cargando diseño…</Text></View> : null}
          {discardConfirmOpen ? <View style={styles.discardOverlay}><View style={styles.discardCard}><Text style={styles.panelTitle}>Cambios sin guardar</Text><Text style={styles.wizardText}>Has creado o modificado este patrón. Si cierras ahora, perderás los cambios.</Text><View style={styles.wizardActions}><Pressable style={styles.secondaryButton} onPress={() => setDiscardConfirmOpen(false)}><Text style={styles.secondaryLabel}>Seguir editando</Text></Pressable><Pressable style={styles.dangerButton} onPress={discardAndClose}><Text style={styles.primaryLabel}>Salir sin guardar</Text></Pressable></View></View></View> : null}
        </View>
  );
  return fullScreen ? <View style={styles.designerScreen}>{designerPanel}</View> : <Modal visible={visible} transparent animationType="fade" onRequestClose={requestClose}><View style={styles.modalBackdrop}>{designerPanel}</View></Modal>;
}

function emptyBlueprint(): ServiceBlueprint {
  return { fields: [], items: [], rules: [], measures: [] };
}

function cloneBlueprint(blueprint: ServiceBlueprint): ServiceBlueprint {
  return JSON.parse(JSON.stringify(blueprint)) as ServiceBlueprint;
}

function readCatalogAttributes(item: BlueprintItem): CatalogAttribute[] {
  const attributes = item.metadata.attributes;
  if (!Array.isArray(attributes)) return [];
  return attributes.filter((attribute): attribute is CatalogAttribute => Boolean(attribute) && typeof attribute === "object" && typeof (attribute as { label?: unknown }).label === "string" && typeof (attribute as { value?: unknown }).value === "string");
}

type EditableRule = BlueprintRule & { definitionText: string };

function editableRule(rule: BlueprintRule): EditableRule {
  return { ...rule, definitionText: JSON.stringify(rule.definition, null, 2) };
}

function parseRuleDefinition(definitionText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(definitionText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function ruleReferenceValue(rule: EditableRule, reference: "field" | "item"): string {
  const definition = parseRuleDefinition(rule.definitionText);
  const value = reference === "field" ? definition.quantity ?? definition.field : definition.item;
  return typeof value === "string" ? value : "";
}

function ruleSummary(rule: EditableRule, fields: BlueprintField[], items: BlueprintItem[]): string {
  const fieldCode = ruleReferenceValue(rule, "field");
  const itemCode = ruleReferenceValue(rule, "item");
  const fieldName = fields.find((field) => field.key === fieldCode)?.label;
  const itemName = items.find((item) => item.sku === itemCode)?.name;
  if (rule.kind === "formula" && fieldName && itemName) return `Calcula ${fieldName} × precio de ${itemName}.`;
  if (rule.kind === "surcharge" && itemName) return `Añade ${itemName} cuando se cumpla la condición configurada.`;
  if (rule.kind === "minimum" && fieldName) return `Aplica un importe mínimo tomando como referencia ${fieldName}.`;
  if (rule.kind === "factor" && fieldName) return `Aplica descuentos o factores según ${fieldName}.`;
  if (rule.kind === "unit_price" && itemName) return `Usa el precio unitario de ${itemName}.`;
  return "Selecciona las referencias para describir qué hará esta regla.";
}

function toEditableRules(rules: BlueprintRule[]): EditableRule[] {
  return rules.map(editableRule);
}

function defaultRuleDefinition(kind: BlueprintRule["kind"]): Record<string, unknown> {
  if (kind === "minimum") return { field: "quantity", minimum: 1 };
  if (kind === "factor") return { field: "quantity", tiers: [{ gte: 500, factor: 0.92 }] };
  if (kind === "surcharge") return { when: {}, amount: 0 };
  return { item: "item_code", quantity: "quantity" };
}

const SERVICE_TEMPLATE_OPTIONS: Array<{ id: ServiceTemplate; label: string; description: string }> = [
  { id: "print", label: "Imprenta y rotulación", description: "Bolsas, libros, cartelería y otros trabajos impresos." },
  { id: "renovation", label: "Reformas y obras", description: "Estancias, materiales, mediciones y mano de obra." },
  { id: "mechanic", label: "Taller y reparación", description: "Averías, piezas, horas y fotografías." },
  { id: "catering", label: "Catering y alimentación", description: "Comensales, menú, servicio y extras." },
  { id: "cleaning", label: "Limpieza profesional", description: "Espacios, frecuencia, superficie y productos." },
  { id: "gardening", label: "Jardinería y exteriores", description: "Superficie, tareas, retirada y mantenimiento." },
  { id: "photography", label: "Fotografía y vídeo", description: "Tipo de sesión, duración, localización y entregables." },
  { id: "transport", label: "Transporte y mudanzas", description: "Origen, destino, volumen, accesos y ayudantes." },
  { id: "it_support", label: "Informática y soporte", description: "Equipo, incidencia, urgencia y horas técnicas." },
  { id: "consulting", label: "Consultoría profesional", description: "Objetivo, alcance, sesiones y entregables." },
  { id: "training", label: "Formación y clases", description: "Materia, asistentes, modalidad y duración." },
  { id: "maintenance", label: "Mantenimiento de instalaciones", description: "Activo, periodicidad, materiales y desplazamiento." }
];

function TemplateSelector({ onSelect, onReset }: { onSelect: (template: ServiceTemplate) => void; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  return <View style={[styles.templateSelectorWrap, open && styles.templateSelectorWrapOpen]}><Pressable style={styles.templateSelector} onPress={() => setOpen(!open)} accessibilityLabel="Seleccionar ayuda orientativa"><Text style={styles.templateSelectorLabel}>Cargar una ayuda orientativa</Text><Text style={styles.templateSelectorArrow}>{open ? "⌃" : "⌄"}</Text></Pressable>{open ? <View style={styles.templateMenu}><Pressable style={styles.templateResetOption} onPress={() => { onReset(); setOpen(false); }}><Text style={styles.templateOptionLabel}>Restablecer servicio</Text><Text style={styles.templateOptionDescription}>Recupera los patrones que tenía el servicio al abrirlo.</Text></Pressable>{SERVICE_TEMPLATE_OPTIONS.map((option) => <Pressable key={option.id} style={styles.templateOption} onPress={() => { onSelect(option.id); setOpen(false); }}><Text style={styles.templateOptionLabel}>{option.label}</Text><Text style={styles.templateOptionDescription}>{option.description}</Text></Pressable>)}</View> : null}</View>;
}

function setDraftFromTemplate(template: ServiceTemplate, setDraft: (blueprint: ServiceBlueprint) => void, setRuleCards: (rules: EditableRule[]) => void, setMeasuresText: (value: string) => void) {
  const blueprint = blueprintFor(template);
  setDraft(blueprint);
  setRuleCards(toEditableRules(blueprint.rules));
  setMeasuresText(JSON.stringify(blueprint.measures, null, 2));
}

function exampleForType(type: string) {
  return { text: "un valor escrito", number: "250", choice: "una opción", boolean: "sí", date: "31/12/2026", file: "una imagen o PDF" }[type] ?? "un valor de ejemplo";
}

function starterBlueprint(fields: BlueprintField[], items: BlueprintItem[], rules: BlueprintRule[] = []): ServiceBlueprint {
  return { fields, items, rules, measures: [] };
}

function blueprintFor(template: ServiceTemplate): ServiceBlueprint {
  if (template === "renovation") return {
    fields: [
      { key: "room", label: "Estancia a reformar", type: "choice", required: true, options: ["baño", "cocina", "salón"], unit: undefined, example: "baño", help_text: "Selecciona el espacio principal de la reforma." },
      { key: "surface_m2", label: "Superficie", type: "number", required: true, options: [], unit: "m²", min: 1, example: "8", help_text: "Puedes pedir una medida aproximada si todavía no hay visita." },
      { key: "tile", label: "Baldosa", type: "choice", required: true, options: ["blanca mate de gres", "porcelánico", "otro"], example: "blanca mate de gres" },
      { key: "faucet", label: "¿Incluye grifería?", type: "boolean", required: true, options: [], example: "sí" },
      { key: "labor_hours", label: "Horas de mano de obra", type: "number", required: true, options: [], unit: "h", min: 0, example: "16" }
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
      { key: "operation", label: "Operación", type: "choice", required: true, options: ["mantenimiento", "reparación", "sustitución"], example: "reparación" },
      { key: "part", label: "Pieza o material", type: "text", required: true, options: [], example: "pastillas de freno" },
      { key: "labor_hours", label: "Horas de mano de obra", type: "number", required: true, options: [], unit: "h", min: 0, example: "2" },
      { key: "repair_photo", label: "Fotografía de la avería", type: "file", required: false, options: [], example: "foto del cuadro de instrumentos" }
    ],
    items: [{ sku: "labor-hour", name: "Hora de mano de obra", unit: "hour", base_price: 45, currency: "EUR", metadata: { category: "labor" } }],
    rules: [{ code: "labor_by_hours", kind: "formula", priority: 10, definition: { quantity: "labor_hours", item: "labor-hour" } }],
    measures: []
  };
  if (template === "catering") return starterBlueprint([
    { key: "service_type", label: "Tipo de servicio", type: "choice", required: true, options: ["entrega", "cóctel", "comida sentada"], example: "cóctel" },
    { key: "guests", label: "Número de comensales", type: "number", required: true, options: [], unit: "personas", min: 1, example: "80" },
    { key: "menu", label: "Menú o propuesta", type: "text", required: true, options: [], example: "menú vegetariano" },
    { key: "event_date", label: "Fecha del evento", type: "date", required: true, options: [], example: "15/06/2027" },
    { key: "venue", label: "Lugar del evento", type: "text", required: true, options: [], example: "finca en Madrid" },
    { key: "dietary_needs", label: "Alergias o necesidades alimentarias", type: "text", required: false, options: [], example: "3 menús sin gluten" }
  ], [
    { sku: "menu-person", name: "Menú por comensal", unit: "person", base_price: 28, currency: "EUR", metadata: { category: "producto" } },
    { sku: "service-staff-hour", name: "Hora de servicio", unit: "hour", base_price: 32, currency: "EUR", metadata: { category: "mano de obra" } }
  ], [{ code: "menu_by_guests", kind: "formula", priority: 10, definition: { quantity: "guests", item: "menu-person" } }]);
  if (template === "cleaning") return starterBlueprint([
    { key: "space_type", label: "Tipo de espacio", type: "choice", required: true, options: ["vivienda", "oficina", "local comercial"], example: "oficina" },
    { key: "surface_m2", label: "Superficie aproximada", type: "number", required: true, options: [], unit: "m²", min: 1, example: "180" },
    { key: "frequency", label: "Frecuencia", type: "choice", required: true, options: ["puntual", "semanal", "diaria"], example: "semanal" },
    { key: "deep_cleaning", label: "¿Necesita limpieza profunda?", type: "boolean", required: true, options: [], example: "no" },
    { key: "supplies", label: "¿Aporta la empresa los productos?", type: "boolean", required: true, options: [], example: "sí" }
  ], [
    { sku: "cleaning-m2", name: "Limpieza por m²", unit: "m²", base_price: 2.5, currency: "EUR", metadata: { category: "mano de obra" } },
    { sku: "cleaning-supplies", name: "Productos de limpieza", unit: "job", base_price: 15, currency: "EUR", metadata: { category: "material" } }
  ], [{ code: "cleaning_by_surface", kind: "formula", priority: 10, definition: { quantity: "surface_m2", item: "cleaning-m2" } }]);
  if (template === "gardening") return starterBlueprint([
    { key: "area_m2", label: "Superficie del jardín", type: "number", required: true, options: [], unit: "m²", min: 1, example: "250" },
    { key: "task", label: "Trabajo necesario", type: "choice", required: true, options: ["mantenimiento", "poda", "diseño", "riego"], example: "poda" },
    { key: "frequency", label: "Frecuencia del servicio", type: "choice", required: true, options: ["puntual", "quincenal", "mensual"], example: "mensual" },
    { key: "green_waste", label: "¿Hay que retirar restos vegetales?", type: "boolean", required: true, options: [], example: "sí" },
    { key: "access_notes", label: "Información sobre el acceso", type: "text", required: false, options: [], example: "acceso por garaje" }
  ], [
    { sku: "garden-maintenance", name: "Mantenimiento de jardín", unit: "m²", base_price: 1.8, currency: "EUR", metadata: { category: "mano de obra" } },
    { sku: "green-waste", name: "Retirada de restos", unit: "job", base_price: 40, currency: "EUR", metadata: { category: "extra" } }
  ], [{ code: "garden_by_area", kind: "formula", priority: 10, definition: { quantity: "area_m2", item: "garden-maintenance" } }]);
  if (template === "photography") return starterBlueprint([
    { key: "session_type", label: "Tipo de sesión", type: "choice", required: true, options: ["producto", "retrato", "evento", "inmobiliaria"], example: "producto" },
    { key: "hours", label: "Duración de la sesión", type: "number", required: true, options: [], unit: "horas", min: 1, example: "4" },
    { key: "location", label: "Localización", type: "text", required: true, options: [], example: "estudio del cliente" },
    { key: "participants", label: "Número de personas", type: "number", required: false, options: [], unit: "personas", min: 1, example: "2" },
    { key: "deliverables", label: "Entregables", type: "choice", required: true, options: ["galería digital", "álbum", "vídeo", "impresiones"], example: "galería digital" }
  ], [
    { sku: "photo-hour", name: "Hora de fotografía", unit: "hour", base_price: 80, currency: "EUR", metadata: { category: "servicio" } },
    { sku: "photo-editing", name: "Edición y retoque", unit: "job", base_price: 120, currency: "EUR", metadata: { category: "extra" } }
  ], [{ code: "photo_by_hours", kind: "formula", priority: 10, definition: { quantity: "hours", item: "photo-hour" } }]);
  if (template === "transport") return starterBlueprint([
    { key: "service_type", label: "Tipo de servicio", type: "choice", required: true, options: ["transporte", "mudanza", "reparto"], example: "mudanza" },
    { key: "origin", label: "Dirección de origen", type: "text", required: true, options: [], example: "Madrid, calle Alcalá 20" },
    { key: "destination", label: "Dirección de destino", type: "text", required: true, options: [], example: "Alcalá de Henares" },
    { key: "volume_m3", label: "Volumen aproximado", type: "number", required: true, options: [], unit: "m³", min: 0.1, example: "12" },
    { key: "elevator", label: "¿Hay ascensor disponible?", type: "boolean", required: true, options: [], example: "no" },
    { key: "helpers", label: "Ayudantes necesarios", type: "number", required: false, options: [], unit: "personas", min: 0, example: "2" }
  ], [
    { sku: "transport-base", name: "Servicio base de transporte", unit: "job", base_price: 80, currency: "EUR", metadata: { category: "servicio" } },
    { sku: "moving-helper", name: "Ayudante de mudanza", unit: "hour", base_price: 25, currency: "EUR", metadata: { category: "mano de obra" } }
  ]);
  if (template === "it_support") return starterBlueprint([
    { key: "device", label: "Equipo o sistema", type: "text", required: true, options: [], example: "portátil Windows" },
    { key: "issue", label: "Problema o tarea", type: "text", required: true, options: [], example: "no inicia" },
    { key: "urgency", label: "Urgencia", type: "choice", required: true, options: ["normal", "prioritaria", "urgente"], example: "prioritaria" },
    { key: "remote", label: "¿Se puede atender a distancia?", type: "boolean", required: true, options: [], example: "sí" },
    { key: "hours", label: "Horas estimadas", type: "number", required: true, options: [], unit: "horas", min: 0.5, example: "2" }
  ], [
    { sku: "it-hour", name: "Hora de soporte técnico", unit: "hour", base_price: 55, currency: "EUR", metadata: { category: "mano de obra" } },
    { sku: "it-visit", name: "Desplazamiento técnico", unit: "job", base_price: 35, currency: "EUR", metadata: { category: "extra" } }
  ], [{ code: "support_by_hours", kind: "formula", priority: 10, definition: { quantity: "hours", item: "it-hour" } }]);
  if (template === "consulting") return starterBlueprint([
    { key: "area", label: "Área de consultoría", type: "choice", required: true, options: ["estrategia", "marketing", "procesos", "finanzas", "recursos humanos"], example: "procesos" },
    { key: "objective", label: "Objetivo del proyecto", type: "text", required: true, options: [], example: "reducir tiempos de entrega" },
    { key: "sessions", label: "Sesiones previstas", type: "number", required: true, options: [], unit: "sesiones", min: 1, example: "6" },
    { key: "modality", label: "Modalidad", type: "choice", required: true, options: ["online", "presencial", "mixta"], example: "mixta" },
    { key: "deliverable", label: "Entregable principal", type: "text", required: true, options: [], example: "plan de mejora" }
  ], [{ sku: "consulting-session", name: "Sesión de consultoría", unit: "session", base_price: 150, currency: "EUR", metadata: { category: "servicio" } }], [{ code: "consulting_by_sessions", kind: "formula", priority: 10, definition: { quantity: "sessions", item: "consulting-session" } }]);
  if (template === "training") return starterBlueprint([
    { key: "topic", label: "Materia o curso", type: "text", required: true, options: [], example: "Excel para equipos" },
    { key: "attendees", label: "Número de asistentes", type: "number", required: true, options: [], unit: "personas", min: 1, example: "12" },
    { key: "modality", label: "Modalidad", type: "choice", required: true, options: ["presencial", "online", "híbrida"], example: "online" },
    { key: "hours", label: "Duración", type: "number", required: true, options: [], unit: "horas", min: 1, example: "8" },
    { key: "materials", label: "¿Incluye materiales?", type: "boolean", required: true, options: [], example: "sí" }
  ], [{ sku: "training-hour", name: "Hora de formación", unit: "hour", base_price: 90, currency: "EUR", metadata: { category: "servicio" } }], [{ code: "training_by_hours", kind: "formula", priority: 10, definition: { quantity: "hours", item: "training-hour" } }]);
  if (template === "maintenance") return starterBlueprint([
    { key: "asset", label: "Instalación o equipo", type: "text", required: true, options: [], example: "climatización de oficina" },
    { key: "task", label: "Tipo de trabajo", type: "choice", required: true, options: ["revisión", "reparación", "sustitución"], example: "revisión" },
    { key: "frequency", label: "Periodicidad", type: "choice", required: true, options: ["puntual", "trimestral", "anual"], example: "trimestral" },
    { key: "hours", label: "Horas estimadas", type: "number", required: true, options: [], unit: "horas", min: 0.5, example: "3" },
    { key: "materials", label: "Materiales o piezas previstos", type: "text", required: false, options: [], example: "filtros y lubricante" }
  ], [
    { sku: "maintenance-hour", name: "Hora de mantenimiento", unit: "hour", base_price: 45, currency: "EUR", metadata: { category: "mano de obra" } },
    { sku: "maintenance-visit", name: "Desplazamiento", unit: "job", base_price: 30, currency: "EUR", metadata: { category: "extra" } }
  ], [{ code: "maintenance_by_hours", kind: "formula", priority: 10, definition: { quantity: "hours", item: "maintenance-hour" } }]);
  return {
    fields: [
      { key: "bag_type", label: "Tipo de bolsa", type: "choice", required: true, options: ["tote bag", "mochila", "saco" ], example: "tote bag" },
      { key: "material", label: "Material", type: "choice", required: true, options: ["algodón", "yute", "poliéster"], example: "algodón" },
      { key: "quantity", label: "Unidades", type: "number", required: true, options: [], unit: "ud", min: 250, example: "250" },
      { key: "size", label: "Talla", type: "choice", required: true, options: ["S", "M", "L"], example: "M" },
      { key: "base_color", label: "Color de base", type: "text", required: true, options: [], example: "crudo" },
      { key: "print_type", label: "Tipo de impresión", type: "choice", required: true, options: ["digital", "serigrafía 2 colores", "serigrafía 4 colores"], example: "serigrafía 2 colores" },
      { key: "artwork_provided", label: "¿Aporta el diseño?", type: "boolean", required: true, options: [], example: "sí" }
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

const FIELD_TYPE_LABELS: Record<string, string> = { text: "Texto", number: "Número", choice: "Opción", boolean: "Sí/No", date: "Fecha", file: "Imagen o archivo" };
const UNIT_OPTIONS = ["m²", "m", "cm", "mm", "unidad", "hora", "día", "servicio", "kg", "g", "litro", "persona"];

function InfoLabel({ label, hint }: { label: string; hint?: string }) {
  const [open, setOpen] = useState(false);
  return <View style={styles.infoLabelWrap}><View style={styles.infoLabelRow}><Text style={styles.fieldLabel}>{label}</Text>{hint ? <Pressable style={styles.infoButton} onPress={() => setOpen(!open)} onHoverIn={() => setOpen(true)} onHoverOut={() => setOpen(false)} accessibilityLabel={`Información sobre ${label}`}><Text style={styles.infoButtonLabel}>?</Text></Pressable> : null}</View>{open && hint ? <View style={styles.tooltip}><Text style={styles.tooltipText}>{hint}</Text></View> : null}</View>;
}

function AnimatedCollapse({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  const progress = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, { toValue: expanded ? 1 : 0, duration: 220, useNativeDriver: false }).start();
  }, [expanded, progress]);

  return <Animated.View pointerEvents={expanded ? "auto" : "none"} style={[styles.collapsibleContent, { opacity: progress, maxHeight: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1200] }) }]}>{children}</Animated.View>;
}

function Field({ label, hint, value, onChangeText, keyboardType, multiline = false, editable = true, placeholder }: { label: string; hint?: string; value: string; onChangeText: (value: string) => void; keyboardType?: "default" | "decimal-pad" | "number-pad"; multiline?: boolean; editable?: boolean; placeholder?: string }) {
  return <View style={styles.field}><InfoLabel label={label} hint={hint} /><TextInput style={[styles.input, multiline && styles.textArea, !editable && styles.readonlyInput]} value={value} onChangeText={onChangeText} placeholder={placeholder} keyboardType={keyboardType} multiline={multiline} editable={editable} textAlignVertical={multiline ? "top" : "center"} /></View>;
}

function FieldTypeSelector({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const types = ["text", "number", "choice", "boolean", "date", "file"];
  const nextType = types[(types.indexOf(value) + 1) % types.length] ?? "text";
  return <View style={styles.field}><InfoLabel label="Cómo responde" hint="Indica qué formato debe usar el cliente. Pulsa el selector para alternar entre texto, número, opción, sí/no, fecha o imagen." /><Pressable style={styles.typeSelector} onPress={() => onChange(nextType)}><Text style={styles.typeSelectorLabel}>{FIELD_TYPE_LABELS[value] ?? value}</Text><Text style={styles.typeSelectorHint}>Pulsa para cambiar</Text></Pressable></View>;
}

function UnitSelector({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const options = value && !UNIT_OPTIONS.includes(value) ? [value, ...UNIT_OPTIONS] : UNIT_OPTIONS;
  return <View style={styles.field}><InfoLabel label="Unidad" hint="Selecciona cómo se cobra o mide este concepto. Por defecto se usa m²." /><Pressable style={styles.typeSelector} onPress={() => setOpen(!open)}><Text style={styles.typeSelectorLabel}>{value || "m²"}</Text><Text style={styles.typeSelectorHint}>{open ? "Cerrar" : "Seleccionar"}</Text></Pressable>{open ? <View style={styles.unitMenu}>{options.map((option) => <Pressable key={option} style={styles.unitOption} onPress={() => { onChange(option); setOpen(false); }}><Text style={styles.unitOptionLabel}>{option}</Text></Pressable>)}</View> : null}</View>;
}

type ReferenceOption = { value: string; label: string };
type DesignerSection = "fields" | "items" | "rules" | "measures";

function ReferenceSelector({ label, hint, value, options, onChange }: { label: string; hint: string; value: string; options: ReferenceOption[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return <View style={[styles.field, open && styles.referenceFieldOpen]}><InfoLabel label={label} hint={hint} /><Pressable style={[styles.typeSelector, !options.length && styles.readonlyInput]} onPress={() => { if (options.length) setOpen(!open); }} disabled={!options.length}><Text style={[styles.typeSelectorLabel, !selected && styles.selectorPlaceholder]}>{selected ? `${selected.value} — ${selected.label}` : options.length ? "Seleccionar una referencia" : "No hay opciones creadas"}</Text><Text style={styles.typeSelectorHint}>{options.length ? (open ? "Cerrar" : "Seleccionar") : ""}</Text></Pressable>{open ? <View style={styles.referenceMenu}>{options.map((option) => <Pressable key={option.value} style={styles.referenceOption} onPress={() => { onChange(option.value); setOpen(false); }}><Text style={styles.referenceOptionCode}>{option.value}</Text><Text style={styles.referenceOptionLabel}>{option.label}</Text></Pressable>)}</View> : null}</View>;
}

function DesignerSectionTabs({ value, onChange, counts }: { value: DesignerSection; onChange: (section: DesignerSection) => void; counts: Record<DesignerSection, number> }) {
  const sections: Array<{ id: DesignerSection; label: string }> = [{ id: "fields", label: "Preguntas" }, { id: "items", label: "Catálogo" }, { id: "rules", label: "Reglas" }, { id: "measures", label: "Medidas" }];
  return <View style={styles.designerTabs}>{sections.map((section) => <Pressable key={section.id} style={[styles.designerTab, value === section.id && styles.designerTabActive]} onPress={() => onChange(section.id)}><Text style={[styles.designerTabLabel, value === section.id && styles.designerTabLabelActive]}>{section.label}</Text><Text style={[styles.designerTabCount, value === section.id && styles.designerTabLabelActive]}>{counts[section.id]}</Text></Pressable>)}</View>;
}

function Toggle({ label, hint, value, onPress }: { label: string; hint?: string; value: boolean; onPress: () => void }) {
  return <Pressable style={styles.toggle} onPress={onPress}><View style={[styles.checkbox, value && styles.checkboxOn]}>{value ? <Text style={styles.check}>✓</Text> : null}</View><View><InfoLabel label={label} hint={hint} /></View></Pressable>;
}

function ModulePlaceholder({ title, text }: { title: string; text: string }) {
  return <View style={styles.empty}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyText}>{text}</Text></View>;
}

function screenTitle(screen: Screen) {
  return { wizard: "Wizard", dashboard: "Resumen", company: "Empresa", services: "Servicios y fichas", knowledge: "Base de conocimiento", designer: "Diseñador de servicios", requests: "Peticiones", quotes: "Presupuestos" }[screen];
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: "row", backgroundColor: "#f6f7f5" },
  sidebar: { width: 250, padding: 28, backgroundColor: "#17332d", minHeight: "100%" },
  brand: { color: "#e7f2e9", fontSize: 22, fontWeight: "800", letterSpacing: 2 },
  brandSub: { color: "#8fc6a9", fontSize: 11, letterSpacing: 2, marginTop: 4 },
  nav: { gap: 6, marginTop: 48 },
  subnav: { marginLeft: 12, paddingLeft: 8, borderLeftWidth: 1, borderLeftColor: "#3b6b5a", gap: 4 },
  navButton: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12 },
  navButtonChild: { paddingVertical: 9, paddingLeft: 12 },
  navButtonActive: { backgroundColor: "#28604d" },
  navLabel: { color: "#b4c8bd", fontSize: 14 },
  navLabelChild: { fontSize: 13 },
  navLabelActive: { color: "#ffffff", fontWeight: "700" },
  sidebarBottom: { marginTop: "auto", paddingTop: 32 },
  sidebarHint: { color: "#8fc6a9", fontSize: 12 },
  sidebarMuted: { color: "#d7e6dc", fontSize: 13, marginTop: 6 },
  content: { flex: 1 },
  contentInner: { padding: 42, maxWidth: 1200, width: "100%", alignSelf: "center" },
  designerWorkspace: { flex: 1, backgroundColor: "#f6f7f5" },
  designerScreen: { flex: 1 },
  designerFullScreenCard: { flex: 1, width: "100%", maxWidth: "100%", maxHeight: "100%", borderRadius: 0, shadowOpacity: 0, padding: 32 },
  designerFullScreenScroll: { maxHeight: "100%", flex: 1 },
  designerPicker: { flex: 1, padding: 42, maxWidth: 1200, width: "100%", alignSelf: "center" },
  designerWorkspaceHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 },
  workspaceTitle: { color: "#17211f", fontSize: 30, fontWeight: "800", marginTop: 5 },
  workspaceText: { color: "#526078", fontSize: 15, lineHeight: 22, marginTop: 8, maxWidth: 720 },
  hidden: { display: "none" },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 28 },
  kicker: { color: "#258269", fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  heading: { color: "#17211f", fontSize: 32, fontWeight: "800", marginTop: 6 },
  refreshButton: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  refreshLabel: { color: "#285246", fontSize: 13, fontWeight: "600" },
  error: { color: "#a53d35", backgroundColor: "#fdecea", borderRadius: 8, padding: 14, marginBottom: 18 },
  success: { color: "#216c55", backgroundColor: "#eaf6ef", borderRadius: 8, padding: 12, marginTop: 10 },
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
  sectionHeaderRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginTop: 10, marginBottom: 10 },
  sectionHeaderContent: { flex: 1 },
  measureActions: { flexDirection: "row", justifyContent: "flex-end", marginTop: 8 },
  designerTabs: { flexDirection: "row", gap: 8, borderBottomWidth: 1, borderBottomColor: "#dbe6df", marginBottom: 16 },
  designerTab: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, paddingVertical: 10, borderBottomWidth: 3, borderBottomColor: "transparent" },
  designerTabActive: { borderBottomColor: "#258269" },
  designerTabLabel: { color: "#718078", fontSize: 13, fontWeight: "700" },
  designerTabLabelActive: { color: "#216c55" },
  designerTabCount: { color: "#718078", fontSize: 11, fontWeight: "800", backgroundColor: "#eef3ef", borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  designerFilterInput: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#ffffff", marginTop: 10, marginBottom: 8, maxWidth: 520 },
  serviceSummaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  serviceActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  tutorialBox: { backgroundColor: "#f7faf8", borderWidth: 1, borderColor: "#dbe6df", borderRadius: 12, padding: 16, marginTop: 18, marginBottom: 8 },
  tutorialTitle: { color: "#17332d", fontSize: 16, fontWeight: "800", marginBottom: 4 },
  tutorialVideo: { width: "100%", height: 280, marginTop: 12, borderRadius: 8, backgroundColor: "#17332d" },
  smallButton: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7, marginTop: 8 },
  smallButtonLabel: { color: "#285246", fontSize: 12, fontWeight: "700" },
  knowledgeBox: { backgroundColor: "#f7f9fc", borderRadius: 10, padding: 16, marginTop: 18 },
  knowledgeCount: { color: "#61736a", fontSize: 12, lineHeight: 18, marginTop: 14 },
  secondaryButton: { alignSelf: "flex-start", borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 11, marginTop: 16 },
  secondaryLabel: { color: "#285246", fontSize: 14, fontWeight: "600" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(23, 51, 45, 0.36)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 620, backgroundColor: "#ffffff", borderRadius: 16, padding: 24, shadowColor: "#000000", shadowOpacity: 0.15, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  confirmCard: { width: "100%", maxWidth: 520, backgroundColor: "#ffffff", borderRadius: 16, padding: 24, shadowColor: "#000000", shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  confirmTitle: { color: "#17332d", fontSize: 20, fontWeight: "800", marginTop: 8 },
  confirmWarning: { color: "#a53d35", backgroundColor: "#fdecea", borderRadius: 8, padding: 12, marginTop: 14, fontSize: 13, fontWeight: "700" },
  designerCard: { width: "100%", maxWidth: 1100, maxHeight: "92%", backgroundColor: "#ffffff", borderRadius: 16, padding: 24, shadowColor: "#000000", shadowOpacity: 0.15, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, position: "relative", overflow: "hidden" },
  designerScroll: { flexShrink: 1, maxHeight: 620 },
  designerLoadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(255, 255, 255, 0.9)", borderRadius: 16, alignItems: "center", justifyContent: "center", zIndex: 40 },
  designerLoadingText: { color: "#285246", fontSize: 14, fontWeight: "700", marginTop: 12 },
  designerRow: { flexDirection: "row", gap: 8, alignItems: "flex-end", borderTopWidth: 1, borderTopColor: "#edf1ee", paddingTop: 7, marginTop: 5 },
  templateChoices: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginBottom: 10, position: "relative", zIndex: 1000 },
  templateSelectorWrap: { position: "relative", zIndex: 10, minWidth: 300 },
  templateSelectorWrapOpen: { zIndex: 1000, elevation: 20 },
  templateSelector: { borderWidth: 1, borderColor: "#b7c8be", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#f7fbf8", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  templateSelectorLabel: { color: "#285246", fontSize: 12, fontWeight: "700" },
  templateSelectorArrow: { color: "#285246", fontSize: 18, lineHeight: 14, marginLeft: 14 },
  templateMenu: { position: "absolute", top: 42, left: 0, right: 0, backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 8, shadowColor: "#000000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, zIndex: 1000, elevation: 20 },
  templateResetOption: { paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "#cbd8d1", backgroundColor: "#f7fbf8" },
  templateOption: { paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "#edf1ee" },
  templateOptionLabel: { color: "#17332d", fontSize: 12, fontWeight: "700" },
  templateOptionDescription: { color: "#718078", fontSize: 11, lineHeight: 15, marginTop: 2 },
  unitMenu: { position: "absolute", top: 56, left: 0, right: 0, backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 8, shadowColor: "#000000", shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, zIndex: 30 },
  unitOption: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#edf1ee" },
  unitOptionLabel: { color: "#17332d", fontSize: 13 },
  referenceFieldOpen: { position: "relative", zIndex: 1000, elevation: 20 },
  referenceMenu: { position: "absolute", top: 56, left: 0, right: 0, backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 8, shadowColor: "#000000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, zIndex: 1000, elevation: 20, maxHeight: 240 },
  referenceOption: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#edf1ee" },
  referenceOptionCode: { color: "#285246", fontSize: 11, fontWeight: "800" },
  referenceOptionLabel: { color: "#17332d", fontSize: 13, marginTop: 2 },
  selectorPlaceholder: { color: "#718078" },
  blockPalette: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 10 },
  paletteButton: { borderWidth: 1, borderColor: "#b7c8be", borderRadius: 16, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: "#f7fbf8" },
  paletteLabel: { color: "#285246", fontSize: 12, fontWeight: "700" },
  blockCard: { borderWidth: 1, borderColor: "#dbe6df", borderRadius: 10, padding: 10, marginTop: 6, backgroundColor: "#fbfdfb" },
  blockHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  blockIndex: { color: "#258269", fontSize: 12, fontWeight: "800", width: 22 },
  blockTitle: { color: "#17332d", fontSize: 14, fontWeight: "700", flex: 1 },
  blockToggle: { flexDirection: "row", alignItems: "center", flex: 1, minWidth: 0 },
  collapseIcon: { color: "#285246", fontSize: 16, fontWeight: "800", paddingHorizontal: 6 },
  collapsibleContent: { marginTop: 2 },
  blockSaveButton: { borderWidth: 1, borderColor: "#8fc6a9", borderRadius: 7, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: "#f0f8f2" },
  blockSaveLabel: { color: "#216c55", fontSize: 11, fontWeight: "800" },
  reorderLabel: { color: "#285246", fontSize: 18, fontWeight: "800", paddingHorizontal: 4 },
  deleteLabel: { color: "#a53d35", fontSize: 12, fontWeight: "700", paddingHorizontal: 4 },
  deleteButton: { borderWidth: 1, borderColor: "#e2b7b2", borderRadius: 7, paddingHorizontal: 8, paddingVertical: 7, marginTop: 8 },
  dangerButton: { alignSelf: "flex-start", backgroundColor: "#a53d35", borderRadius: 8, paddingHorizontal: 18, paddingVertical: 12, marginTop: 8 },
  ruleDetailInput: { minHeight: 72, fontFamily: "monospace", fontSize: 12 },
  codeInput: { fontFamily: "monospace", fontSize: 12 },
  infoLabelWrap: { position: "relative", zIndex: 2 },
  infoLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  infoButton: { width: 17, height: 17, borderRadius: 9, borderWidth: 1, borderColor: "#8da99b", alignItems: "center", justifyContent: "center", marginBottom: 7 },
  infoButtonLabel: { color: "#285246", fontSize: 11, fontWeight: "800" },
  tooltip: { position: "absolute", top: 22, left: 0, minWidth: 190, maxWidth: 280, backgroundColor: "#17332d", borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, zIndex: 20 },
  tooltipText: { color: "#ffffff", fontSize: 11, lineHeight: 16 },
  typeSelector: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#fbfcfb", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  typeSelectorLabel: { color: "#17332d", fontSize: 14 },
  typeSelectorHint: { color: "#718078", fontSize: 11 },
  exampleHint: { color: "#61736a", backgroundColor: "#f0f7f2", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, fontSize: 12, marginTop: 2 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalClose: { color: "#52645b", fontSize: 28, lineHeight: 28, paddingHorizontal: 6 },
  discardOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(23, 51, 45, 0.42)", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 50 },
  discardCard: { width: "100%", maxWidth: 500, backgroundColor: "#ffffff", borderRadius: 14, padding: 22, shadowColor: "#000000", shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
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
  field: { flex: 1, marginBottom: 8 },
  fieldLabel: { color: "#52645b", fontSize: 12, fontWeight: "700", marginBottom: 4 },
  sectionLabel: { color: "#17332d", fontSize: 14, fontWeight: "800", marginTop: 10, marginBottom: 10 },
  readonly: { color: "#17332d", fontSize: 16, paddingBottom: 18 },
  formGrid: { flexDirection: "row", gap: 14 },
  input: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: "#17332d", backgroundColor: "#fbfcfb" },
  readonlyInput: { color: "#718078", backgroundColor: "#f1f4f2" },
  textArea: { minHeight: 92 },
  documentChoices: { flexDirection: "row", gap: 10 },
  documentChoice: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  documentChoiceActive: { borderColor: "#258269", backgroundColor: "#e8f4ed" },
  documentChoiceLabel: { color: "#285246", fontSize: 13, fontWeight: "600" },
  toggle: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
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
