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
const int pin2 = 2;  // Spindle ON/OFF (HIGH = ON, LOW = OFF)
const int pin3 = 3;  // Process Start Signal
const int pin4 = 4;  // Process End Signal

// ======================
// ⚙️ Debouncing Configuration
// ======================
const unsigned long DEBOUNCE_DELAY = 100; // 100ms debounce time

// Debounce tracking for each pin
struct PinDebounce {
  int lastStableState;
  int currentReading;
  unsigned long lastChangeTime;
};

PinDebounce pin2Debounce = {LOW, LOW, 0};
PinDebounce pin3Debounce = {LOW, LOW, 0};
PinDebounce pin4Debounce = {LOW, LOW, 0};

// ======================
// ⚙️ States
// ======================
int stablePin2 = LOW;
int stablePin3 = LOW;
int stablePin4 = LOW;

bool spindleRunning = false;
unsigned long spindleStart = 0;
unsigned long spindleOnTime = 0; // Accumulated ON time in milliseconds

unsigned long lastUpdate = 0;
const unsigned long UPDATE_INTERVAL = 1000; // 1 sec refresh when spindle running

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
// 🛡️ Debounce Function
// ======================
int debouncedRead(int pin, PinDebounce &debounce) {
  int reading = digitalRead(pin);
  unsigned long now = millis();
  
  // If reading changed, reset the debounce timer
  if (reading != debounce.currentReading) {
    debounce.currentReading = reading;
    debounce.lastChangeTime = now;
  }
  
  // If enough time has passed, accept the new reading
  if ((now - debounce.lastChangeTime) > DEBOUNCE_DELAY) {
    if (reading != debounce.lastStableState) {
      debounce.lastStableState = reading;
    }
  }
  
  return debounce.lastStableState;
}

// ======================
// 📤 Send Update to Server
// ======================
bool sendUpdate(int p2, int p3, int p4, unsigned long onTime) {
  if (!client.connect(server, port)) {
    Serial.println("❌ Connection failed");
    return false;
  }

  // Build JSON payload
  String json = "{";
  json += "\"name\":\"" + String(deviceName) + "\",";
  json += "\"pin2\":" + String(p2) + ",";
  json += "\"pin3\":" + String(p3) + ",";
  json += "\"pin4\":" + String(p4) + ",";
  json += "\"onTime\":" + String(onTime); // milliseconds
  json += "}";

  // Send HTTP POST request
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
  while (millis() - start < 300 && client.available() == 0) { 
    delay(10); 
  }
  while (client.available()) {
    client.read();
  }
  client.stop();

  // Debug output
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
  
  // Configure pins as inputs with internal pull-down
  pinMode(pin2, INPUT_PULLDOWN);
  pinMode(pin3, INPUT_PULLDOWN);
  pinMode(pin4, INPUT_PULLDOWN);
  
  // Initialize debounce states
  pin2Debounce.lastStableState = digitalRead(pin2);
  pin3Debounce.lastStableState = digitalRead(pin3);
  pin4Debounce.lastStableState = digitalRead(pin4);
  
  stablePin2 = pin2Debounce.lastStableState;
  stablePin3 = pin3Debounce.lastStableState;
  stablePin4 = pin4Debounce.lastStableState;
  
  connectWiFi();
  
  Serial.println("🚀 Spindle Monitor Ready!");
  Serial.println("Pin 2: Spindle ON/OFF (HIGH=ON, LOW=OFF)");
  Serial.println("Pin 3: Process Start Signal");
  Serial.println("Pin 4: Process End Signal");
  Serial.println("Debounce: 100ms");
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

  // Read debounced pin states
  int p2 = debouncedRead(pin2, pin2Debounce);
  int p3 = debouncedRead(pin3, pin3Debounce);
  int p4 = debouncedRead(pin4, pin4Debounce);

  // --- Spindle ON/OFF logic ---
  // When pin2 gets 5V (HIGH) → Spindle starts
  if (p2 == HIGH && !spindleRunning) {
    spindleRunning = true;
    spindleStart = millis();
    Serial.println("🟢 Spindle Started (Pin 2 = HIGH)");
  }

  // When 5V is removed from pin2 (LOW) → Spindle stops
  if (p2 == LOW && spindleRunning) {
    spindleRunning = false;
    spindleOnTime += millis() - spindleStart;
    Serial.print("🔴 Spindle Stopped (Pin 2 = LOW) | Total ON time: ");
    Serial.print(spindleOnTime / 1000);
    Serial.println(" sec");
  }

  // --- Compute current ON time ---
  unsigned long currentOnTime = spindleOnTime;
  if (spindleRunning) {
    currentOnTime += (millis() - spindleStart);
  }

  // --- Detect any state change (after debouncing) ---
  bool changed = (p2 != stablePin2) || (p3 != stablePin3) || (p4 != stablePin4);

  // --- Send update on change OR every 1s when spindle running ---
  if (changed || (spindleRunning && millis() - lastUpdate >= UPDATE_INTERVAL)) {
    sendUpdate(p2, p3, p4, currentOnTime);
    lastUpdate = millis();
  }

  // Save current stable states for next loop
  stablePin2 = p2;
  stablePin3 = p3;
  stablePin4 = p4;

  delay(20); // Small delay to prevent excessive CPU usage
}