import { StatusBar } from "expo-status-bar";
import { createElement, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

type Service = { slug: string; name: string; description?: string | null; created_at: string };
type ChatLine = { sender: "customer" | "assistant"; body: string };
type ActiveField = { key: string; label: string; type: string; unit?: string; options?: string[] };
type AccountResponse = { session_token: string; email_sent: boolean };

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";
const TENANT_SLUG = process.env.EXPO_PUBLIC_TENANT_SLUG ?? "empresa-demo-uno";
const CUSTOMER_SESSION_STORAGE_KEY = "horekia.customer.session";
const latoRootStyle = { fontFamily: "Lato", fontSize: 15 } as any;

function readCustomerSession(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(CUSTOMER_SESSION_STORAGE_KEY); } catch { return null; }
}

function storeCustomerSession(token: string): void {
  try { window.localStorage.setItem(CUSTOMER_SESSION_STORAGE_KEY, token); } catch { /* storage may be unavailable */ }
}

function clearCustomerSession(): void {
  try { window.localStorage.removeItem(CUSTOMER_SESSION_STORAGE_KEY); } catch { /* storage may be unavailable */ }
}

function decorateLegacyOpening(body: string): string {
  if (body.includes("**") || !body.startsWith("Hola")) return body;
  return body
    .replace(/^(Hola,\s+)([^.\n]+)(\.)/, "$1**$2**$3")
    .replace(/más adecuado/g, "**más adecuado**")
    .replace(/(Para saber si nuestro ámbito de actuación es viable,\s*¿dónde deberíamos prestar el servicio\?)/g, "**$1**");
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) }, ...options });
  if (!response.ok) {
    let detail = `API ${response.status}`;
    try { detail = (await response.json() as { detail?: string }).detail ?? detail; } catch { /* keep status */ }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function PublicMessageBody({ body }: { body: string }) {
  const formattedBody = decorateLegacyOpening(body);
  return <Text style={styles.messageText}>{formattedBody.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith("**") && part.endsWith("**") ? <Text key={`${part}-${index}`} style={styles.messageBold}>{part.slice(2, -2)}</Text> : part)}</Text>;
}

export default function App() {
  const [services, setServices] = useState<Service[]>([]);
  const [serviceQuery, setServiceQuery] = useState("");
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [quoteAvailable, setQuoteAvailable] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailFailed, setEmailFailed] = useState(false);
  const [activeField, setActiveField] = useState<ActiveField | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountPasswordConfirmation, setAccountPasswordConfirmation] = useState("");
  const [sessionToken, setSessionToken] = useState<string | null>(() => readCustomerSession());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [completingAccount, setCompletingAccount] = useState(false);
  const [conversationClosed, setConversationClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesScrollRef = useRef<ScrollView | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const customerNameRef = useRef<TextInput | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const link = document.createElement("link");
    const style = document.createElement("style");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Lato:wght@400;900&display=swap";
    link.setAttribute("data-horekia-font", "lato");
    style.setAttribute("data-horekia-font-style", "lato");
    style.textContent = `
      body, body * { font-family: "Lato", sans-serif !important; }
      body [style*="monospace"] { font-family: monospace !important; }
    `;
    document.head.appendChild(link);
    document.head.appendChild(style);
    return () => {
      link.remove();
      style.remove();
    };
  }, []);

  useEffect(() => { void loadServices(); }, []);

  useEffect(() => {
    const timer = setTimeout(() => messagesScrollRef.current?.scrollToEnd({ animated: true }), 40);
    return () => clearTimeout(timer);
  }, [messages, sending]);

  useEffect(() => {
    if (!selectedService || !requestId || sending || conversationClosed || quoteAvailable || emailSent) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [selectedService, requestId, sending, conversationClosed, quoteAvailable, emailSent, messages.length]);

  useEffect(() => {
    if (!selectedService || requestId) return;
    const timer = setTimeout(() => customerNameRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [selectedService, requestId]);

  const loadServices = async () => {
    setLoading(true); setError(null);
    try { setServices(await api<Service[]>(`/api/v1/public/tenants/${encodeURIComponent(TENANT_SLUG)}/services`)); }
    catch { setError("No se han podido cargar los servicios. Comprueba que la API esté arrancada."); }
    finally { setLoading(false); }
  };

  const chooseService = (service: Service) => {
    setSelectedService(service); setConversationClosed(false); setRequestId(null); setMessages([]); setQuoteAvailable(false); setEmailSent(false); setEmailFailed(false); setActiveField(null); setDraft(""); setCustomerName(""); setCustomerEmail(""); setAccountPassword(""); setAccountPasswordConfirmation(""); setError(null);
    if (sessionToken) void startConversation(service, sessionToken);
  };

  const startConversation = async (serviceOverride?: Service, sessionOverride?: string | null) => {
    const service = serviceOverride ?? selectedService;
    const activeSession = sessionOverride ?? sessionToken;
    if (!service) return;
    if (!activeSession && (!customerName.trim() || customerName.trim().length < 2)) { setError("Escribe tu nombre para continuar."); return; }
    if (!activeSession && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customerEmail.trim())) { setError("Escribe un email válido para continuar."); return; }
    setConversationClosed(false); setRequestId(null); setMessages([]); setQuoteAvailable(false); setEmailSent(false); setEmailFailed(false); setActiveField(null); setDraft(""); setSending(true); setError(null);
    try {
      const result = await api<{ request_id: string; message: { body: string }; field?: ActiveField | null }>(`/api/v1/public/tenants/${encodeURIComponent(TENANT_SLUG)}/conversations`, { method: "POST", body: JSON.stringify({ job_type_slug: service.slug, ...(activeSession ? { session_token: activeSession } : { customer_name: customerName.trim(), customer_email: customerEmail.trim() }) }) });
      setRequestId(result.request_id); setMessages([{ sender: "assistant", body: result.message.body }]); setActiveField(result.field ?? null);
    } catch (requestError) {
      if (activeSession) {
        setSessionToken(null); clearCustomerSession(); setError("Tu sesión ha caducado. Introduce tu nombre y email para continuar.");
      } else {
        setError(requestError instanceof Error ? requestError.message : "No se ha podido iniciar la conversación con este servicio.");
      }
    }
    finally { setSending(false); }
  };

  const sendMessage = async (preset?: string) => {
    const content = (preset ?? draft).trim();
    if (!content || !requestId || sending || conversationClosed) return;
    setDraft(""); setMessages((current) => [...current, { sender: "customer", body: content }]); setSending(true); setError(null);
    try {
      const result = await api<{ reply: string; status?: string; field?: ActiveField | null; quote_available?: boolean; email_sent?: boolean }>(`/api/v1/public/conversations/${requestId}/messages`, { method: "POST", body: JSON.stringify({ content, ...(activeField?.key ? { field_key: activeField.key } : {}), ...(sessionToken ? { session_token: sessionToken } : {}) }) });
      setMessages((current) => [...current, { sender: "assistant", body: result.reply }]); setActiveField(result.field ?? null); setConversationClosed(result.status === "closed"); if (result.quote_available) setQuoteAvailable(true); if (result.email_sent) setEmailSent(true); if (result.status === "quoted" && sessionToken && !result.email_sent) setEmailFailed(true);
    } catch (requestError) {
      if (sessionToken) { setSessionToken(null); clearCustomerSession(); setError("Tu sesión ha caducado. Vuelve a identificarte para continuar."); }
      else setError("No se ha podido enviar el mensaje. Inténtalo de nuevo.");
    }
    finally { setSending(false); }
  };

  const completeAccount = async () => {
    if (!requestId) return;
    if (accountPassword.length < 8) { setError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (accountPassword !== accountPasswordConfirmation) { setError("Las contraseñas no coinciden."); return; }
    setCompletingAccount(true); setError(null);
    try {
      const result = await api<AccountResponse>(`/api/v1/public/conversations/${requestId}/account`, { method: "POST", body: JSON.stringify({ password: accountPassword, password_confirmation: accountPasswordConfirmation }) });
      setSessionToken(result.session_token); storeCustomerSession(result.session_token); setEmailSent(result.email_sent); setQuoteAvailable(false); setAccountPassword(""); setAccountPasswordConfirmation("");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No se ha podido activar la cuenta."); }
    finally { setCompletingAccount(false); }
  };

  const restart = () => { setSelectedService(null); setRequestId(null); setMessages([]); setQuoteAvailable(false); setEmailSent(false); setEmailFailed(false); setActiveField(null); setConversationClosed(false); setCustomerName(""); setCustomerEmail(""); setAccountPassword(""); setAccountPasswordConfirmation(""); setError(null); };

  const visibleServices = serviceQuery.trim()
    ? services.filter((service) => `${service.name} ${service.slug} ${service.description ?? ""}`.toLocaleLowerCase().includes(serviceQuery.trim().toLocaleLowerCase()))
    : services.slice(0, 10);

  return <View style={[styles.shell, Platform.OS === "web" ? latoRootStyle : null]}>
    <StatusBar style="dark" />
    <ScrollView contentContainerStyle={styles.page}>
    <View style={[styles.header, { alignItems: "center" }]}><View style={styles.headerBrand}>{Platform.OS === "web" ? createElement("img", { src: "/horekia-logo-app-new.svg?v=1", alt: "HorekIA", style: styles.brandImage }) : <Text style={styles.brand}>HOREKIA</Text>}</View><Text style={styles.headerHint}>Prepara tu presupuesto paso a paso</Text></View>
      <View style={styles.card}>
        {!selectedService ? <>
          <Text style={styles.title}>¿Qué necesitas presupuestar?</Text><Text style={styles.subtitle}>Elige un servicio y te haré las preguntas necesarias para preparar tu solicitud.</Text>
          {loading ? <ActivityIndicator color="#258269" size="large" style={styles.loader} /> : services.length === 0 ? <Text style={styles.empty}>No hay servicios publicados todavía.</Text> : <><TextInput style={styles.serviceSearch} value={serviceQuery} onChangeText={setServiceQuery} placeholder="Buscar un servicio…" autoCapitalize="none" /><Text style={styles.serviceSectionTitle}>{serviceQuery.trim() ? `Resultados para «${serviceQuery.trim()}»` : "Servicios más recientes"}</Text>{visibleServices.length === 0 ? <Text style={styles.empty}>No hemos encontrado ningún servicio con esa búsqueda.</Text> : <View style={styles.services}>{visibleServices.map((service) => <Pressable key={service.slug} style={styles.service} onPress={() => chooseService(service)} disabled={sending}><View style={styles.serviceCopy}><Text style={styles.serviceTitle}>{service.name}</Text><Text style={styles.serviceDescription}>{service.description || "Preparar una solicitud de presupuesto."}</Text></View><Text style={styles.serviceArrow}>→</Text></Pressable>)}</View>}{!serviceQuery.trim() && services.length > 10 ? <Text style={styles.serviceHint}>Mostramos los 10 servicios más recientes. Usa el buscador para localizar cualquier otro.</Text> : null}</>}
        </> : <>
          {!requestId && !sessionToken ? <View style={styles.contactStep}><Text style={styles.contactTitle}>Antes de empezar</Text><Text style={styles.subtitle}>Dinos tu nombre y email para poder identificar tu solicitud y entregarte el presupuesto cuando esté preparado.</Text><TextInput ref={customerNameRef} style={styles.inputFull} value={customerName} onChangeText={setCustomerName} placeholder="Tu nombre" autoFocus editable={!sending} returnKeyType="next" /><TextInput style={styles.inputFull} value={customerEmail} onChangeText={setCustomerEmail} placeholder="Tu email" keyboardType="email-address" autoCapitalize="none" editable={!sending} onSubmitEditing={() => void startConversation()} returnKeyType="send" /><Pressable style={styles.sendFull} onPress={() => void startConversation()} disabled={sending}><Text style={styles.sendLabel}>{sending ? "Preparando…" : "Continuar"}</Text></Pressable></View> : !requestId ? <ActivityIndicator color="#258269" size="large" style={styles.loader} /> : null}
          {requestId ? <>
          <View style={styles.chatHeader}><View><Text style={styles.title}>{selectedService.name}</Text><Text style={styles.subtitle}>Asistente de presupuesto</Text></View><Pressable onPress={restart}><Text style={styles.restart}>Cambiar servicio</Text></Pressable></View>
          <ScrollView ref={messagesScrollRef} style={styles.messages} contentContainerStyle={styles.messagesContent}>{messages.map((message, index) => <View key={`${message.sender}-${index}`} style={[styles.message, message.sender === "customer" ? styles.customerMessage : styles.assistantMessage]}><PublicMessageBody body={message.body} /></View>)}{sending ? <ActivityIndicator color="#258269" size="small" style={styles.chatLoader} /> : null}</ScrollView>
          {emailSent ? <View style={styles.accountBox}><Text style={styles.accountTitle}>Presupuesto enviado</Text><Text style={styles.accountText}>Te hemos enviado el presupuesto por email. El documento queda pendiente de revisión por la empresa.</Text></View> : emailFailed ? <View style={styles.accountBox}><Text style={styles.accountTitle}>No se ha podido enviar el presupuesto</Text><Text style={styles.accountText}>La solicitud se ha guardado correctamente, pero el envío de email necesita revisión de la configuración de correo.</Text></View> : null}
          {quoteAvailable && !sessionToken ? <View style={styles.accountBox}><Text style={styles.accountTitle}>Tu presupuesto ya está preparado</Text><Text style={styles.accountText}>Crea una contraseña para terminar el alta. Después recibirás el presupuesto por email.</Text><TextInput style={styles.inputFull} value={accountPassword} onChangeText={setAccountPassword} placeholder="Crea una contraseña (8 caracteres mínimo)" secureTextEntry editable={!completingAccount} /><TextInput style={styles.inputFull} value={accountPasswordConfirmation} onChangeText={setAccountPasswordConfirmation} placeholder="Repite la contraseña" secureTextEntry editable={!completingAccount} onSubmitEditing={() => void completeAccount()} returnKeyType="send" /><Pressable style={styles.sendFull} onPress={() => void completeAccount()} disabled={completingAccount}><Text style={styles.sendLabel}>{completingAccount ? "Activando cuenta…" : "Crear cuenta y recibir presupuesto"}</Text></Pressable></View> : emailSent || emailFailed ? null : conversationClosed ? <View style={styles.closedComposer}><Text style={styles.closedHint}>Esta conversación ha terminado. Puedes iniciar una nueva solicitud si lo necesitas.</Text><Pressable style={styles.newConversation} onPress={restart} disabled={sending}><Text style={styles.sendLabel}>Iniciar otra conversación</Text></Pressable></View> : activeField?.type === "boolean" ? <View style={styles.booleanComposer}><Text style={styles.booleanHint}>Selecciona una respuesta:</Text><View style={styles.booleanChoices}><Pressable style={styles.booleanButton} onPress={() => void sendMessage("sí")} disabled={sending}><Text style={styles.booleanButtonLabel}>Sí</Text></Pressable><Pressable style={styles.booleanButton} onPress={() => void sendMessage("no")} disabled={sending}><Text style={styles.booleanButtonLabel}>No</Text></Pressable></View></View> : activeField?.type === "choice" && activeField.options?.length ? <View style={styles.choiceComposer}><Text style={styles.booleanHint}>Selecciona una opción:</Text><View style={styles.choiceOptions}>{activeField.options.map((option) => <Pressable key={option} style={styles.choiceButton} onPress={() => void sendMessage(option)} disabled={sending}><Text style={styles.choiceButtonLabel}>{option}</Text></Pressable>)}</View></View> : <View style={styles.composer}><TextInput ref={inputRef} style={styles.input} value={draft} onChangeText={setDraft} placeholder="Escribe tu respuesta…" editable={!sending} autoFocus onSubmitEditing={() => void sendMessage()} returnKeyType="send" /><Pressable style={styles.send} onPress={() => void sendMessage()} disabled={sending || !draft.trim()}><Text style={styles.sendLabel}>{sending ? "…" : "Enviar"}</Text></Pressable></View>}
          </> : null}
        </>}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View><Text style={styles.footer}>HorekIA · Conversación de solicitud de presupuesto</Text>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: "#f6f7f5" }, page: { width: "100%", maxWidth: 860, alignSelf: "center", padding: 32, minHeight: "100%" }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 32 }, brand: { color: "#17332d", fontSize: 22, fontWeight: "900", letterSpacing: 2 }, headerHint: { color: "#718078", fontSize: 15 }, card: { backgroundColor: "#ffffff", borderRadius: 18, borderWidth: 1, borderColor: "#dbe6df", padding: 28, minHeight: 520 }, title: { color: "#17332d", fontSize: 25, fontWeight: "900" }, subtitle: { color: "#61736a", fontSize: 15, lineHeight: 22, marginTop: 8 }, loader: { marginTop: 90 }, empty: { color: "#61736a", marginTop: 36 }, serviceSearch: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 11, color: "#17332d", backgroundColor: "#fbfcfb", marginTop: 24 }, serviceSectionTitle: { color: "#285246", fontSize: 13, fontWeight: "900", marginTop: 22 }, serviceHint: { color: "#718078", fontSize: 12, lineHeight: 18, marginTop: 14 }, services: { gap: 12, marginTop: 12 }, service: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 12, padding: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, serviceCopy: { flex: 1 }, serviceTitle: { color: "#17332d", fontSize: 17, fontWeight: "900" }, serviceDescription: { color: "#718078", fontSize: 13, lineHeight: 19, marginTop: 5 }, serviceArrow: { color: "#258269", fontSize: 25, marginLeft: 18 }, chatHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 1, borderBottomColor: "#edf1ee", paddingBottom: 16 }, restart: { color: "#258269", fontSize: 12, fontWeight: "900", padding: 5 }, messages: { height: 300, marginVertical: 18 }, messagesContent: { gap: 10, paddingBottom: 8 }, message: { maxWidth: "82%", borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10 }, assistantMessage: { alignSelf: "flex-start", backgroundColor: "#f0f5f1" }, customerMessage: { alignSelf: "flex-end", backgroundColor: "#dcefe4" }, messageText: { color: "#285246", fontSize: 15, lineHeight: 21 }, messageBold: { fontWeight: "900" }, chatLoader: { alignSelf: "flex-start", margin: 8 }, contactStep: { marginTop: 30, maxWidth: 560 }, contactTitle: { color: "#17332d", fontSize: 20, fontWeight: "900" }, inputFull: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 11, color: "#17332d", backgroundColor: "#fbfcfb", marginTop: 12 }, sendFull: { alignSelf: "flex-start", backgroundColor: "#258269", borderRadius: 9, paddingHorizontal: 18, paddingVertical: 12, marginTop: 14 }, accountBox: { backgroundColor: "#eef7f0", borderRadius: 12, padding: 16, marginBottom: 14 }, accountTitle: { color: "#17332d", fontSize: 17, fontWeight: "900" }, accountText: { color: "#61736a", fontSize: 13, lineHeight: 19, marginTop: 5 }, quote: { backgroundColor: "#eef7f0", borderRadius: 12, padding: 16, marginBottom: 14 }, quoteLabel: { color: "#285246", fontSize: 12, fontWeight: "900" }, quoteValue: { color: "#17332d", fontSize: 25, fontWeight: "900" }, quoteHint: { color: "#61736a", fontSize: 12, marginTop: 4 }, booleanComposer: { borderWidth: 1, borderColor: "#dbe6df", borderRadius: 10, padding: 12, backgroundColor: "#fbfcfb" }, booleanHint: { color: "#61736a", fontSize: 12, marginBottom: 8 }, booleanChoices: { flexDirection: "row", gap: 8 }, booleanButton: { flex: 1, backgroundColor: "#258269", borderRadius: 8, alignItems: "center", paddingVertical: 11 }, booleanButtonLabel: { color: "#ffffff", fontSize: 15, fontWeight: "900" }, choiceComposer: { borderWidth: 1, borderColor: "#dbe6df", borderRadius: 10, padding: 12, backgroundColor: "#fbfcfb" }, choiceOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, choiceButton: { backgroundColor: "#258269", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11 }, choiceButtonLabel: { color: "#ffffff", fontSize: 15, fontWeight: "900" }, composer: { flexDirection: "row", gap: 8, alignItems: "center" }, closedComposer: { borderWidth: 1, borderColor: "#dbe6df", borderRadius: 10, padding: 14, backgroundColor: "#fbfcfb" }, closedHint: { color: "#61736a", fontSize: 13, lineHeight: 19, marginBottom: 10 }, newConversation: { alignSelf: "flex-start", backgroundColor: "#258269", borderRadius: 9, paddingHorizontal: 17, paddingVertical: 12 }, input: { flex: 1, borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 11, color: "#17332d", backgroundColor: "#fbfcfb" }, send: { backgroundColor: "#258269", borderRadius: 9, paddingHorizontal: 17, paddingVertical: 12 }, sendLabel: { color: "#ffffff", fontSize: 13, fontWeight: "900" }, error: { color: "#a53d35", backgroundColor: "#fdecea", borderRadius: 8, padding: 12, marginTop: 18, fontSize: 13 }, footer: { color: "#718078", fontSize: 12, textAlign: "center", marginTop: 18 },
  headerBrand: { width: 190, height: 36, justifyContent: "center", backgroundColor: "transparent" },
  brandImage: { width: 190, height: 35, backgroundColor: "transparent" },
});
