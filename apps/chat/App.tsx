import { StatusBar } from "expo-status-bar";
import { createElement, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

type Service = { slug: string; name: string; description?: string | null; created_at: string; sector_pack_name?: string | null };
type ChatLine = { sender: "customer" | "assistant"; body: string };
type ActiveField = { key: string; label: string; type: string; unit?: string; options?: string[] };
type AccountResponse = { session_token: string; email_sent: boolean };
type CustomerQuote = { id: string; status: string; currency: string; subtotal: string; tax_amount: string; total: string; valid_until?: string | null; created_at: string; service_name?: string | null; service_slug?: string | null; lines?: Array<{ description: string; quantity: string; unit_price: string; amount: string }> };
type CustomerAccount = { customer: { id: string; name: string; email: string; phone?: string | null; account_created_at?: string | null }; quotes: CustomerQuote[] };

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

function customerQuoteStatus(status: string): string {
  return ({ needs_review: "Pendiente de revisión", approved: "Aprobado", sent: "Enviado", accepted: "Solicitud enviada", rejected: "Rechazado", expired: "Caducado" } as Record<string, string>)[status] ?? status;
}

function formatCustomerAmount(value: string, currency: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${value} ${currency}`;
  return `${amount.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function CustomerAccountPanel({ account, loading, requestingQuoteId, message, onBack, onRequestExecution }: { account: CustomerAccount | null; loading: boolean; requestingQuoteId: string | null; message: string | null; onBack: () => void; onRequestExecution: (quoteId: string) => void }) {
  return <View>
    <View style={styles.accountHeader}><View><Text style={styles.title}>Mi cuenta</Text><Text style={styles.subtitle}>Consulta tus presupuestos y decide cuáles quieres encargar.</Text></View><Pressable onPress={onBack}><Text style={styles.restart}>Volver a servicios</Text></Pressable></View>
    {loading ? <ActivityIndicator color="#258269" size="large" style={styles.loader} /> : account ? <>
      <View style={styles.profileBox}><Text style={styles.accountTitle}>{account.customer.name}</Text><Text style={styles.accountText}>{account.customer.email}</Text></View>
      <Text style={styles.accountSectionTitle}>Mis presupuestos</Text>
      {account.quotes.length === 0 ? <Text style={styles.empty}>Todavía no tienes presupuestos.</Text> : <View style={styles.quoteList}>{account.quotes.map((quote) => <View style={styles.quoteCard} key={quote.id}><View style={styles.quoteHeader}><View style={styles.serviceCopy}><Text style={styles.quoteLabel}>{quote.service_name || "Presupuesto"}</Text><Text style={styles.quoteStatus}>{customerQuoteStatus(quote.status)}</Text></View><Text style={styles.quoteValue}>{formatCustomerAmount(quote.total, quote.currency)}</Text></View><Text style={styles.quoteDate}>Creado el {new Date(quote.created_at).toLocaleDateString("es-ES")}</Text>{quote.status === "accepted" ? <Text style={styles.accountText}>La empresa ha recibido tu solicitud para llevar a cabo este presupuesto.</Text> : ["needs_review", "approved", "sent"].includes(quote.status) ? <Pressable style={styles.sendFull} onPress={() => onRequestExecution(quote.id)} disabled={requestingQuoteId === quote.id}><Text style={styles.sendLabel}>{requestingQuoteId === quote.id ? "Enviando…" : "Solicitar llevarlo a cabo"}</Text></Pressable> : null}</View>)}</View>}
      {message ? <Text style={styles.success}>{message}</Text> : null}
    </> : <Text style={styles.error}>No se ha podido cargar tu cuenta. Vuelve a iniciar sesión.</Text>}
  </View>;
}

function CustomerLoginModal({ visible, email, password, loading, error, onEmailChange, onPasswordChange, onSubmit, onClose }: { visible: boolean; email: string; password: string; loading: boolean; error: string | null; onEmailChange: (value: string) => void; onPasswordChange: (value: string) => void; onSubmit: () => void; onClose: () => void }) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.modalCard}><View style={styles.modalHeader}><Text style={styles.accountTitle}>Acceder a mi cuenta</Text><Pressable onPress={onClose}><Text style={styles.modalClose}>×</Text></Pressable></View><Text style={styles.subtitle}>Consulta tus presupuestos o inicia una nueva solicitud como cliente identificado.</Text><TextInput style={styles.inputFull} value={email} onChangeText={onEmailChange} placeholder="Tu email" keyboardType="email-address" autoCapitalize="none" editable={!loading} autoFocus /><TextInput style={styles.inputFull} value={password} onChangeText={onPasswordChange} placeholder="Tu contraseña" secureTextEntry editable={!loading} onSubmitEditing={onSubmit} /><Pressable style={styles.sendFull} onPress={onSubmit} disabled={loading}><Text style={styles.sendLabel}>{loading ? "Accediendo…" : "Acceder"}</Text></Pressable>{error ? <Text style={styles.error}>{error}</Text> : null}</View></View></Modal>;
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
  const [accountOpen, setAccountOpen] = useState(() => typeof window !== "undefined" && window.location.pathname.endsWith("/account"));
  const [customerAccount, setCustomerAccount] = useState<CustomerAccount | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [requestingQuoteId, setRequestingQuoteId] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [completingAccount, setCompletingAccount] = useState(false);
  const [conversationClosed, setConversationClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesScrollRef = useRef<ScrollView | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const customerNameRef = useRef<TextInput | null>(null);

  const restart = () => { setSelectedService(null); setRequestId(null); setMessages([]); setQuoteAvailable(false); setEmailSent(false); setEmailFailed(false); setActiveField(null); setConversationClosed(false); setCustomerName(""); setCustomerEmail(""); setAccountPassword(""); setAccountPasswordConfirmation(""); setError(null); setAccountOpen(false); setAccountMessage(null); if (Platform.OS === "web") window.history.pushState({}, "", "/"); };

  const navigateAccount = (open: boolean) => { setAccountOpen(open); setAccountMessage(null); if (Platform.OS === "web") window.history.pushState({}, "", open ? "/account" : "/"); };

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
    if (Platform.OS !== "web") return;
    const onPopState = () => setAccountOpen(window.location.pathname.endsWith("/account"));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (sessionToken) void loadAccount();
    else setCustomerAccount(null);
  }, [sessionToken]);

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
    if (!emailSent) return;
    const timer = setTimeout(restart, 5000);
    return () => clearTimeout(timer);
  }, [emailSent]);

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

  const loadAccount = async () => {
    if (!sessionToken) return;
    setAccountLoading(true);
    try {
      setCustomerAccount(await api<CustomerAccount>(`/api/v1/public/tenants/${encodeURIComponent(TENANT_SLUG)}/account`, { headers: { "X-Customer-Session": sessionToken } }));
    } catch {
      setSessionToken(null); clearCustomerSession(); setCustomerAccount(null); setAccountOpen(false); setError("Tu sesión ha caducado. Vuelve a iniciar sesión.");
    } finally { setAccountLoading(false); }
  };

  const login = async () => {
    if (!loginEmail.trim() || !loginPassword) { setLoginError("Escribe tu email y contraseña."); return; }
    setLoginLoading(true); setLoginError(null);
    try {
      const result = await api<AccountResponse & { customer: { name: string; email: string } }>(`/api/v1/public/tenants/${encodeURIComponent(TENANT_SLUG)}/auth/login`, { method: "POST", body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }) });
      setSessionToken(result.session_token); storeCustomerSession(result.session_token); setLoginOpen(false); setLoginPassword(""); navigateAccount(true);
    } catch (loginRequestError) { setLoginError(loginRequestError instanceof Error ? loginRequestError.message : "No se ha podido iniciar sesión."); }
    finally { setLoginLoading(false); }
  };

  const logout = async () => {
    const token = sessionToken;
    try { if (token) await api(`/api/v1/public/tenants/${encodeURIComponent(TENANT_SLUG)}/auth/logout`, { method: "POST", headers: { "X-Customer-Session": token } }); } catch { /* local logout remains available */ }
    setSessionToken(null); clearCustomerSession(); setCustomerAccount(null); navigateAccount(false);
  };

  const requestExecution = async (quoteId: string) => {
    if (!sessionToken) return;
    setRequestingQuoteId(quoteId); setAccountMessage(null);
    try {
      const result = await api<{ status: string; message: string }>(`/api/v1/public/tenants/${encodeURIComponent(TENANT_SLUG)}/quotes/${encodeURIComponent(quoteId)}/request-execution`, { method: "POST", headers: { "X-Customer-Session": sessionToken } });
      setAccountMessage(result.message); await loadAccount();
    } catch (requestError) { setAccountMessage(requestError instanceof Error ? requestError.message : "No se ha podido enviar la solicitud."); }
    finally { setRequestingQuoteId(null); }
  };

  const chooseService = (service: Service) => {
    navigateAccount(false);
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

  const visibleServices = serviceQuery.trim()
    ? services.filter((service) => `${service.name} ${service.slug} ${service.description ?? ""}`.toLocaleLowerCase().includes(serviceQuery.trim().toLocaleLowerCase()))
    : services.slice(0, 10);

  return <View style={[styles.shell, Platform.OS === "web" ? latoRootStyle : null]}>
    <StatusBar style="dark" />
    <ScrollView contentContainerStyle={styles.page}>
    <View style={[styles.header, { alignItems: "center" }]}><View style={styles.headerBrand}>{Platform.OS === "web" ? createElement("img", { src: "/horekia-logo-app-new.svg?v=1", alt: "HorekIA", style: styles.brandImage }) : <Text style={styles.brand}>HOREKIA</Text>}</View><View style={styles.headerRight}><Text style={styles.headerHint}>Prepara tu presupuesto paso a paso</Text><Pressable style={styles.accountLink} onPress={() => sessionToken ? navigateAccount(!accountOpen) : (setLoginError(null), setLoginOpen(true))}><Text style={styles.accountLinkLabel}>{sessionToken ? (accountOpen ? "Volver" : "Mi cuenta") : "Acceder"}</Text></Pressable>{sessionToken ? <Pressable style={styles.logoutLink} onPress={() => void logout()}><Text style={styles.logoutLabel}>Salir</Text></Pressable> : null}</View></View>
      <View style={styles.card}>
        {!selectedService ? accountOpen && sessionToken ? <CustomerAccountPanel account={customerAccount} loading={accountLoading} requestingQuoteId={requestingQuoteId} message={accountMessage} onBack={() => navigateAccount(false)} onRequestExecution={(quoteId) => void requestExecution(quoteId)} /> : <>
          <Text style={styles.title}>¿Qué necesitas presupuestar?</Text><Text style={styles.subtitle}>Elige un servicio y te haré las preguntas necesarias para preparar tu solicitud.</Text>
          {loading ? <ActivityIndicator color="#258269" size="large" style={styles.loader} /> : services.length === 0 ? <Text style={styles.empty}>No hay servicios publicados todavía.</Text> : <><TextInput style={styles.serviceSearch} value={serviceQuery} onChangeText={setServiceQuery} placeholder="Buscar un servicio…" autoCapitalize="none" /><Text style={styles.serviceSectionTitle}>{serviceQuery.trim() ? `Resultados para «${serviceQuery.trim()}»` : "Servicios más recientes"}</Text>{visibleServices.length === 0 ? <Text style={styles.empty}>No hemos encontrado ningún servicio con esa búsqueda.</Text> : <View style={styles.services}>{visibleServices.map((service) => <Pressable key={service.slug} style={styles.service} onPress={() => chooseService(service)} disabled={sending}><View style={styles.serviceCopy}>{service.sector_pack_name ? <Text style={styles.serviceCategory}>{service.sector_pack_name}</Text> : null}<Text style={styles.serviceTitle}>{service.name}</Text><Text style={styles.serviceDescription}>{service.description || "Preparar una solicitud de presupuesto."}</Text></View><Text style={styles.serviceArrow}>→</Text></Pressable>)}</View>}{!serviceQuery.trim() && services.length > 10 ? <Text style={styles.serviceHint}>Mostramos los 10 servicios más recientes. Usa el buscador para localizar cualquier otro.</Text> : null}</>}
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
    <CustomerLoginModal visible={loginOpen} email={loginEmail} password={loginPassword} loading={loginLoading} error={loginError} onEmailChange={setLoginEmail} onPasswordChange={setLoginPassword} onSubmit={() => void login()} onClose={() => setLoginOpen(false)} />
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: "#f6f7f5" }, page: { width: "100%", maxWidth: 860, alignSelf: "center", padding: 32, minHeight: "100%" }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 32 }, brand: { color: "#17332d", fontSize: 22, fontWeight: "900", letterSpacing: 2 }, headerHint: { color: "#718078", fontSize: 15 }, headerRight: { flexDirection: "row", alignItems: "center", gap: 14 }, accountLink: { paddingVertical: 5 }, accountLinkLabel: { color: "#258269", fontSize: 13, fontWeight: "900" }, logoutLink: { paddingVertical: 5 }, logoutLabel: { color: "#a53d35", fontSize: 13, fontWeight: "900" }, card: { backgroundColor: "#ffffff", borderRadius: 18, borderWidth: 1, borderColor: "#dbe6df", padding: 28, minHeight: 520 }, title: { color: "#17332d", fontSize: 25, fontWeight: "900" }, subtitle: { color: "#61736a", fontSize: 15, lineHeight: 22, marginTop: 8 }, loader: { marginTop: 90 }, empty: { color: "#61736a", marginTop: 36 }, serviceSearch: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 11, color: "#17332d", backgroundColor: "#fbfcfb", marginTop: 24 }, serviceSectionTitle: { color: "#285246", fontSize: 13, fontWeight: "900", marginTop: 22 }, serviceHint: { color: "#718078", fontSize: 12, lineHeight: 18, marginTop: 14 }, services: { gap: 12, marginTop: 12 }, service: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 12, padding: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, serviceCopy: { flex: 1 }, serviceCategory: { color: "#258269", fontSize: 11, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }, serviceTitle: { color: "#17332d", fontSize: 17, fontWeight: "900" }, serviceDescription: { color: "#718078", fontSize: 13, lineHeight: 19, marginTop: 5 }, serviceArrow: { color: "#258269", fontSize: 25, marginLeft: 18 }, accountHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 1, borderBottomColor: "#edf1ee", paddingBottom: 16, marginBottom: 18 }, profileBox: { backgroundColor: "#eef7f0", borderRadius: 12, padding: 16, marginBottom: 22 }, accountSectionTitle: { color: "#17332d", fontSize: 18, fontWeight: "900", marginBottom: 10 }, quoteList: { gap: 12 }, quoteCard: { borderWidth: 1, borderColor: "#dbe6df", borderRadius: 12, padding: 16, backgroundColor: "#fbfcfb" }, quoteHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, quoteStatus: { color: "#61736a", fontSize: 13, marginTop: 4 }, quoteDate: { color: "#718078", fontSize: 12, marginTop: 10 }, success: { color: "#216c55", backgroundColor: "#edf7f0", borderRadius: 8, padding: 12, marginTop: 16, fontSize: 13 }, chatHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 1, borderBottomColor: "#edf1ee", paddingBottom: 16 }, restart: { color: "#258269", fontSize: 12, fontWeight: "900", padding: 5 }, messages: { height: 300, marginVertical: 18 }, messagesContent: { gap: 10, paddingBottom: 8 }, message: { maxWidth: "82%", borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10 }, assistantMessage: { alignSelf: "flex-start", backgroundColor: "#f0f5f1" }, customerMessage: { alignSelf: "flex-end", backgroundColor: "#dcefe4" }, messageText: { color: "#285246", fontSize: 15, lineHeight: 21 }, messageBold: { fontWeight: "900" }, chatLoader: { alignSelf: "flex-start", margin: 8 }, contactStep: { marginTop: 30, maxWidth: 560 }, contactTitle: { color: "#17332d", fontSize: 20, fontWeight: "900" }, inputFull: { borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 11, color: "#17332d", backgroundColor: "#fbfcfb", marginTop: 12 }, sendFull: { alignSelf: "flex-start", backgroundColor: "#258269", borderRadius: 9, paddingHorizontal: 18, paddingVertical: 12, marginTop: 14 }, accountBox: { backgroundColor: "#eef7f0", borderRadius: 12, padding: 16, marginBottom: 14 }, accountTitle: { color: "#17332d", fontSize: 17, fontWeight: "900" }, accountText: { color: "#61736a", fontSize: 13, lineHeight: 19, marginTop: 5 }, quote: { backgroundColor: "#eef7f0", borderRadius: 12, padding: 16, marginBottom: 14 }, quoteLabel: { color: "#285246", fontSize: 12, fontWeight: "900" }, quoteValue: { color: "#17332d", fontSize: 25, fontWeight: "900" }, quoteHint: { color: "#61736a", fontSize: 12, marginTop: 4 }, booleanComposer: { borderWidth: 1, borderColor: "#dbe6df", borderRadius: 10, padding: 12, backgroundColor: "#fbfcfb" }, booleanHint: { color: "#61736a", fontSize: 12, marginBottom: 8 }, booleanChoices: { flexDirection: "row", gap: 8 }, booleanButton: { flex: 1, backgroundColor: "#258269", borderRadius: 8, alignItems: "center", paddingVertical: 11 }, booleanButtonLabel: { color: "#ffffff", fontSize: 15, fontWeight: "900" }, choiceComposer: { borderWidth: 1, borderColor: "#dbe6df", borderRadius: 10, padding: 12, backgroundColor: "#fbfcfb" }, choiceOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, choiceButton: { backgroundColor: "#258269", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11 }, choiceButtonLabel: { color: "#ffffff", fontSize: 15, fontWeight: "900" }, composer: { flexDirection: "row", gap: 8, alignItems: "center" }, closedComposer: { borderWidth: 1, borderColor: "#dbe6df", borderRadius: 10, padding: 14, backgroundColor: "#fbfcfb" }, closedHint: { color: "#61736a", fontSize: 13, lineHeight: 19, marginBottom: 10 }, newConversation: { alignSelf: "flex-start", backgroundColor: "#258269", borderRadius: 9, paddingHorizontal: 17, paddingVertical: 12 }, input: { flex: 1, borderWidth: 1, borderColor: "#cbd8d1", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 11, color: "#17332d", backgroundColor: "#fbfcfb" }, send: { backgroundColor: "#258269", borderRadius: 9, paddingHorizontal: 17, paddingVertical: 12 }, sendLabel: { color: "#ffffff", fontSize: 13, fontWeight: "900" }, error: { color: "#a53d35", backgroundColor: "#fdecea", borderRadius: 8, padding: 12, marginTop: 18, fontSize: 13 }, modalBackdrop: { flex: 1, backgroundColor: "rgba(23, 51, 45, 0.36)", alignItems: "center", justifyContent: "center", padding: 24 }, modalCard: { width: "100%", maxWidth: 520, backgroundColor: "#ffffff", borderRadius: 16, padding: 24 }, modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, modalClose: { color: "#52645b", fontSize: 28, lineHeight: 28, paddingHorizontal: 6 }, footer: { color: "#718078", fontSize: 12, textAlign: "center", marginTop: 18 },
  headerBrand: { width: 190, height: 36, justifyContent: "center", backgroundColor: "transparent" },
  brandImage: { width: 190, height: 35, backgroundColor: "transparent" },
});
