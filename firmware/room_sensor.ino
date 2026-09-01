/**
 * MirrorCity Room Twin — ESP8266 Sensor Node
 * ============================================
 * Hardware:
 *   - ESP8266 (NodeMCU / Wemos D1 Mini)
 *   - DHT22 temperature + humidity sensor → DATA pin → D4 (GPIO2)
 *   - PIR motion sensor (HC-SR501)        → OUT pin  → D5 (GPIO14)
 *   - (optional) MQ-135 CO2 sensor        → AOUT pin → A0
 *
 * Wiring:
 *   DHT22  VCC → 3.3V     DHT22  GND → GND    DHT22  DATA → D4
 *   PIR    VCC → 5V (Vin) PIR    GND → GND    PIR    OUT  → D5
 *   MQ-135 VCC → 3.3V     MQ-135 GND → GND    MQ-135 AOUT → A0
 *
 * Libraries (install via Arduino Library Manager):
 *   - DHT sensor library by Adafruit
 *   - Adafruit Unified Sensor
 *   - ESP8266WiFi (built in)
 *   - ESP8266HTTPClient (built in)
 *   - ArduinoJson by Benoit Blanchon
 *
 * Board: "LOLIN(WEMOS) D1 R2 & mini" or "NodeMCU 1.0 (ESP-12E)"
 * Upload speed: 115200
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>
#include <DHT.h>
#include <ArduinoJson.h>

// ─── CONFIG — edit these ─────────────────────────────────────────────────────

const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Your Cloudflare Worker URL (no trailing slash)
// If running locally: "http://192.168.x.x:3000"
// If deployed:        "https://mirrorcity.your-subdomain.workers.dev"
const char* API_BASE      = "https://mirrorcity.YOUR_SUBDOMAIN.workers.dev";

// Room ID in the database (1 if you only have one room)
const int ROOM_ID = 1;

// How often to send a reading (milliseconds)
const unsigned long SEND_INTERVAL_MS = 30000;

// ─── PIN DEFINITIONS ─────────────────────────────────────────────────────────

#define DHT_PIN     2   // D4 on NodeMCU = GPIO2
#define DHT_TYPE    DHT22
#define PIR_PIN     14  // D5 on NodeMCU = GPIO14
#define MQ135_PIN   A0  // Analog — optional, comment out if not connected
#define LED_PIN     LED_BUILTIN

// ─── GLOBALS ─────────────────────────────────────────────────────────────────

DHT dht(DHT_PIN, DHT_TYPE);
unsigned long lastSend = 0;
String hardwareId;

// ─── SETUP ───────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n\n[MirrorCity] Room sensor node booting…");

  pinMode(PIR_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH); // LED off (active low on NodeMCU)

  dht.begin();

  // Derive hardware ID from MAC address (last 4 hex bytes)
  hardwareId = "ESP_" + WiFi.macAddress().substring(9);
  hardwareId.replace(":", "");
  Serial.println("[MirrorCity] Hardware ID: " + hardwareId);

  // Connect to WiFi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[MirrorCity] Connecting to WiFi");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[MirrorCity] WiFi connected: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[MirrorCity] WiFi failed — will retry in loop");
  }
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────

void loop() {
  unsigned long now = millis();
  if (now - lastSend < SEND_INTERVAL_MS) return;
  lastSend = now;

  // Reconnect if dropped
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[MirrorCity] WiFi disconnected, reconnecting…");
    WiFi.reconnect();
    delay(3000);
    return;
  }

  // ── Read sensors ──────────────────────────────────────────────────────────
  float temperature = dht.readTemperature();
  float humidity    = dht.readHumidity();
  int   occupancy   = digitalRead(PIR_PIN);

  // Optional MQ-135 CO2 approximation
  // The MQ-135 gives an analog voltage, not a calibrated ppm.
  // This is a rough linear approximation — calibrate for your unit.
  int rawCO2 = analogRead(MQ135_PIN);           // 0–1023
  float co2ppm = 400.0 + (rawCO2 / 1023.0) * 1600.0;  // maps 0–1023 → 400–2000 ppm

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("[MirrorCity] DHT22 read failed — skipping this cycle");
    return;
  }

  Serial.printf("[MirrorCity] T=%.1f°C  H=%.1f%%  PIR=%d  CO2~%.0fppm\n",
                temperature, humidity, occupancy, co2ppm);

  // ── Build JSON payload ────────────────────────────────────────────────────
  StaticJsonDocument<256> doc;
  doc["hardwareId"] = hardwareId;
  doc["roomId"]     = ROOM_ID;
  JsonObject readings = doc.createNestedObject("readings");
  readings["temperature"] = round(temperature * 10) / 10.0;
  readings["humidity"]    = round(humidity * 10) / 10.0;
  readings["occupancy"]   = occupancy;
  readings["co2"]         = round(co2ppm);

  String body;
  serializeJson(doc, body);
  Serial.println("[MirrorCity] Posting: " + body);

  // ── POST to /api/ingest ───────────────────────────────────────────────────
  String url = String(API_BASE) + "/api/ingest";

  // Use BearSSL for HTTPS (Cloudflare Workers require HTTPS)
  std::unique_ptr<BearSSL::WiFiClientSecure> client(new BearSSL::WiFiClientSecure);
  client->setInsecure(); // Skip cert validation (fine for a local experiment)

  HTTPClient http;
  http.begin(*client, url);
  http.addHeader("Content-Type", "application/json");

  int code = http.POST(body);
  String response = http.getString();
  http.end();

  if (code == 200 || code == 201) {
    Serial.println("[MirrorCity] ✓ Posted OK — response: " + response);
    // Blink LED once to confirm
    digitalWrite(LED_PIN, LOW);  delay(80);
    digitalWrite(LED_PIN, HIGH);
  } else {
    Serial.printf("[MirrorCity] ✗ HTTP %d — %s\n", code, response.c_str());
    // Blink 3 times to signal error
    for (int i = 0; i < 3; i++) {
      digitalWrite(LED_PIN, LOW);  delay(100);
      digitalWrite(LED_PIN, HIGH); delay(100);
    }
  }
}
