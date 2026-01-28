#include <WiFiS3.h>
#include <Arduino.h>

// ======================
// 🔧 WiFi Configuration
// ======================
const char* ssid = "JIO Office";
const char* password = "12345678@";

// ======================
// 🌐 Server Configuration
// ======================
const char* server = "192.168.31.142";  // your PC IP
const int port = 3000;
const char* deviceName = "arduino-1";

// Static IP for Arduino
IPAddress localIP(192, 168, 31, 50);
IPAddress gateway(192, 168, 31, 1);
IPAddress subnet(255, 255, 255, 0);

WiFiClient client;

// ======================
// ⚙️ Pins
// ======================
const int pin2 = 2;  // Spindle ON/OFF
const int pin3 = 3;  // Process Start Signal
const int pin4 = 4;  // Process End Signal

// ======================
// ⚙️ States
// ======================
int lastPin2 = LOW;
int lastPin3 = LOW;
int lastPin4 = LOW;

bool spindleRunning = false;
unsigned long spindleStart = 0;
unsigned long spindleOnTime = 0; // Accumulated ON time

unsigned long lastUpdate = 0;
const unsigned long UPDATE_INTERVAL = 1000; // 1 sec refresh

// ======================
// 🔌 Connect WiFi
// ======================
void connectWiFi() {
  Serial.print("Connecting to WiFi...");
  WiFi.config(localIP, gateway, subnet);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ WiFi connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
}

// ======================
// 📤 Send Update to Server
// ======================
bool sendUpdate(int p2, int p3, int p4, unsigned long onTime) {
  if (!client.connect(server, port)) {
    Serial.println("❌ Connection failed");
    return false;
  }

  String json = "{";
  json += "\"name\":\"" + String(deviceName) + "\",";
  json += "\"pin2\":" + String(p2) + ",";
  json += "\"pin3\":" + String(p3) + ",";
  json += "\"pin4\":" + String(p4) + ",";
  json += "\"onTime\":" + String(onTime / 1000); // seconds
  json += "}";

  client.print(
    String("POST /update HTTP/1.1\r\n") +
    "Host: " + server + "\r\n" +
    "Content-Type: application/json\r\n" +
    "Content-Length: " + json.length() + "\r\n" +
    "Connection: close\r\n\r\n" +
    json
  );

  // Read and discard response
  unsigned long start = millis();
  while (millis() - start < 300 && client.available() == 0) { delay(10); }
  while (client.available()) client.read();
  client.stop();

  Serial.print("📡 Sent → p2=");
  Serial.print(p2);
  Serial.print(" p3=");
  Serial.print(p3);
  Serial.print(" p4=");
  Serial.print(p4);
  Serial.print(" | onTime=");
  Serial.print(onTime / 1000);
  Serial.println("s");

  return true;
}

// ======================
// ⚙️ Setup
// ======================
void setup() {
  Serial.begin(115200);
  delay(1000);
  pinMode(pin2, INPUT);
  pinMode(pin3, INPUT);
  pinMode(pin4, INPUT);
  connectWiFi();
}

// ======================
// 🔁 Loop
// ======================
void loop() {
  // --- Reconnect if WiFi lost ---
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️ WiFi lost. Reconnecting...");
    connectWiFi();
    delay(1000);
    return;
  }

  int p2 = digitalRead(pin2);
  int p3 = digitalRead(pin3);
  int p4 = digitalRead(pin4);

  // --- Spindle ON/OFF logic ---
  if (p2 == HIGH && !spindleRunning) {
    spindleRunning = true;
    spindleStart = millis();
    Serial.println("🟢 Spindle Started");
  }

  if (p2 == LOW && spindleRunning) {
    spindleRunning = false;
    spindleOnTime += millis() - spindleStart;
    Serial.print("🔴 Spindle Stopped | Total ON time: ");
    Serial.print(spindleOnTime / 1000);
    Serial.println(" sec");
  }

  // --- Compute current ON time ---
  unsigned long currentOnTime = spindleOnTime;
  if (spindleRunning) currentOnTime += (millis() - spindleStart);

  // --- Detect any state change ---
  bool changed = (p2 != lastPin2) || (p3 != lastPin3) || (p4 != lastPin4);

  // --- Send update on change or 1s interval when spindle ON ---
  if (changed || (spindleRunning && millis() - lastUpdate >= UPDATE_INTERVAL)) {
    sendUpdate(p2, p3, p4, currentOnTime);
    lastUpdate = millis();
  }

  lastPin2 = p2;
  lastPin3 = p3;
  lastPin4 = p4;

  delay(20);
}
