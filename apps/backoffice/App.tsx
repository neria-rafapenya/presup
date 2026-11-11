import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>HOREKIA</Text>
      <Text style={styles.title}>Backoffice de la empresa</Text>
      <Text style={styles.body}>
        Base de configuración preparada para fichas, reglas, peticiones y presupuestos.
      </Text>
      <Text style={styles.status}>Fase 1 · API y datos en preparación</Text>
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 32, backgroundColor: "#f7f4ef" },
  eyebrow: { color: "#1a6b5c", fontSize: 13, fontWeight: "700", letterSpacing: 2 },
  title: { color: "#17211f", fontSize: 32, fontWeight: "700", marginTop: 10 },
  body: { color: "#52605b", fontSize: 16, lineHeight: 24, marginTop: 16, maxWidth: 520 },
  status: { color: "#1a6b5c", fontSize: 14, marginTop: 28 }
});
