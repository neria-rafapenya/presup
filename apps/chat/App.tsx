import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Hola, soy el asistente de Horekia</Text>
      <Text style={styles.body}>
        Esta conversación se configurará con las fichas de la empresa y solicitará solo los datos
        necesarios para preparar una petición.
      </Text>
      <Text style={styles.status}>Modo de desarrollo · IA simulada</Text>
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 32, backgroundColor: "#fffdf9" },
  title: { color: "#17211f", fontSize: 30, fontWeight: "700", maxWidth: 540 },
  body: { color: "#52605b", fontSize: 16, lineHeight: 24, marginTop: 16, maxWidth: 540 },
  status: { color: "#1a6b5c", fontSize: 14, marginTop: 28 }
});
