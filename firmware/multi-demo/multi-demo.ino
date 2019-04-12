

#include <bluefruit.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <SparkFun_MMA8452Q.h>
#include <linethings_temp.h>

// BLE Service UUID
#define USER_SERVICE_UUID "d22a87ff-d0da-437d-83eb-d931f2c37e3c"
#define USER_CHARACTERISTIC_WRITE_UUID "112cba25-3166-48c2-bcc7-4a07a0b83b63"
#define PSDI_SERVICE_UUID "e625601e-9e55-4597-a598-76018a0d293d"
#define PSDI_CHARACTERISTIC_UUID "26e2b12b-85f0-4f3f-9fdd-91d114270e6e"

#define BLE_DEV_NAME "LINE Things multi conn demo"

#define BLE_MAX_PRPH_CONNECTION 3

#define SW1 29
#define SW2 28
#define LED_DS2 7
#define LED_DS3 11
#define LED_DS4 19
#define LED_DS5 17
#define GPIO2 2
#define GPIO3 3
#define GPIO4 4
#define GPIO5 5
#define GPIO12 12
#define GPIO13 13
#define GPIO14 14
#define GPIO15 15
#define GPIO16 16

/*********************************************************************************
* I2C Peripherals
*********************************************************************************/
// ディスプレイ (SSD1306) のインスタンスを生成
Adafruit_SSD1306 display(128, 64, &Wire, -1);
// 加速度センサ (MMA8452) のインスタンスを生成
MMA8452Q accel(0x1C);
// 温度センサ (AT30TS74) のインスタンスを生成
ThingsTemp temp = ThingsTemp();

/*********************************************************************************
* Buzzer
*********************************************************************************/
#define BUZZER_PIN 27
SoftwareTimer buzzer;

// ブザーを鳴らすために 1kHz の周期でイベントを生成
void buzzerEvent(TimerHandle_t xTimerID) {
  digitalWrite(BUZZER_PIN, !digitalRead(BUZZER_PIN));
}

void buzzerStart() {
  pinMode(BUZZER_PIN, OUTPUT);
  buzzer.begin(1, buzzerEvent);
  buzzer.start();
}

void buzzerStop() {
  buzzer.stop();
  digitalWrite(BUZZER_PIN, 0);
}

/*********************************************************************************
* BLE settings
*********************************************************************************/
// Advertising service UUID
uint8_t blesv_user_uuid[16];
BLEService blesv_user = BLEService(blesv_user_uuid);

// LINE Things PSDI service
uint8_t blesv_line_uuid[16];
uint8_t blesv_line_product_uuid[16];
BLEService blesv_line = BLEService(blesv_line_uuid);
BLECharacteristic blesv_line_product = BLECharacteristic(blesv_line_product_uuid);

// LINE Things development board service
uint8_t blesv_devboard_uuid[16];
uint8_t blesv_devboard_write_uuid[16];
BLEService blesv_devboard = BLEService(blesv_devboard_uuid);
BLECharacteristic blesv_devboard_write = BLECharacteristic(blesv_devboard_write_uuid);

// UUID Converter
void strUUID2Bytes(String strUUID, uint8_t binUUID[]) {
  String hexString = String(strUUID);
  hexString.replace("-", "");

  for (int i = 16; i != 0; i--) {
    binUUID[i - 1] =
        hex2c(hexString[(16 - i) * 2], hexString[((16 - i) * 2) + 1]);
  }
}

char hex2c(char c1, char c2) { return (nibble2c(c1) << 4) + nibble2c(c2); }

char nibble2c(char c) {
  if ((c >= '0') && (c <= '9')) return c - '0';
  if ((c >= 'A') && (c <= 'F')) return c + 10 - 'A';
  if ((c >= 'a') && (c <= 'f')) return c + 10 - 'a';
  return 0;
}

void bleConfigure(int power) {
  // UUID setup
  strUUID2Bytes(PSDI_SERVICE_UUID, blesv_line_uuid);
  strUUID2Bytes(PSDI_CHARACTERISTIC_UUID, blesv_line_product_uuid);
  strUUID2Bytes(USER_SERVICE_UUID, blesv_devboard_uuid);
  strUUID2Bytes(USER_CHARACTERISTIC_WRITE_UUID, blesv_devboard_write_uuid);
  // BLE start
  Bluefruit.begin(BLE_MAX_PRPH_CONNECTION, 0);
  // Set max Tx power
  // Accepted values are: -40, -30, -20, -16, -12, -8, -4, 0, 4
  Bluefruit.setTxPower(power);

  // BLE devicename
  Bluefruit.setName(BLE_DEV_NAME);
  Bluefruit.Periph.setConnInterval(12, 1600);  // connection interval min=20ms, max=2s
  // Set the connect/disconnect callback handlers
  Bluefruit.Periph.setConnectCallback(bleConnectEvent);
  Bluefruit.Periph.setDisconnectCallback(bleDisconnectEvent);
}

void bleStartAdvertising(void) {
  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.setFastTimeout(0);
  Bluefruit.Advertising.setInterval(32, 32);  // interval : 20ms
  Bluefruit.Advertising.restartOnDisconnect(true);
  // LINE app 側で発見するために User service UUID を必ずアドバタイズパケットに含める
  Bluefruit.Advertising.addService(blesv_devboard);
  Bluefruit.ScanResponse.addName();
  Bluefruit.Advertising.start();
}

void bleSetupServicePsdi(void) {
  blesv_line.begin();
  blesv_line_product.setProperties(CHR_PROPS_READ);
  blesv_line_product.setPermission(SECMODE_ENC_NO_MITM, SECMODE_ENC_NO_MITM);
  blesv_line_product.setFixedLen(sizeof(uint32_t) * 2);
  blesv_line_product.begin();
  uint32_t deviceAddr[] = {NRF_FICR->DEVICEADDR[0], NRF_FICR->DEVICEADDR[1]};
  blesv_line_product.write(deviceAddr, sizeof(deviceAddr));
}

void bleSetupServiceDevice() {
  blesv_devboard.begin();

  blesv_devboard_write.setProperties(CHR_PROPS_WRITE);
  blesv_devboard_write.setPermission(SECMODE_ENC_NO_MITM, SECMODE_ENC_NO_MITM);
  blesv_devboard_write.setWriteCallback(bleWriteEvent);
  blesv_devboard_write.setFixedLen(16);
  blesv_devboard_write.begin();
}

void bleSetupServiceUser() {
  blesv_user.begin();
}

volatile int g_central_count = 0;
volatile int g_message_index = 0;
volatile char g_message_history[5][20];

void drawDisplayInfo(){
  display.clearDisplay();
  display.setCursor(0, 0);
  for (int i = 0; i < 5; i++) {
    for (int j = 0; j < 16; j++){
        display.print(g_message_history[i][j]);
        Serial.print(g_message_history[i][j]);
    }
    //display.println(g_message_history[i]);
    display.println("");
    Serial.println("");
  }

  display.setCursor(0, 50);
  display.print("Connection : " + String(g_central_count));
  display.display();            // ディスプレイを更新
}

// Event for connect BLE central
void bleConnectEvent(uint16_t conn_handle) {
  char central_name[32] = {0};

  g_central_count++;

  BLEConnection* connection = Bluefruit.Connection(conn_handle);
  connection->getPeerName(central_name, sizeof(central_name));

  Serial.print("Connected from ");
  Serial.println(central_name);

  Serial.println("Keep advertising");
  Bluefruit.Advertising.start(0);

  drawDisplayInfo();
}

// Event for disconnect BLE central
void bleDisconnectEvent(uint16_t conn_handle, uint8_t reason) {
  (void)reason;
  (void)conn_handle;
  g_central_count--;
  Serial.println("BLE central disconnect");

  drawDisplayInfo();
}

void bleWriteEvent(uint16_t conn_handle, BLECharacteristic* chr, uint8_t* data, uint16_t len) {
  char central_name[32] = {0};

  Serial.println("BLE Write");


  BLEConnection* connection = Bluefruit.Connection(conn_handle);
  connection->getPeerName(central_name, sizeof(central_name));

  for (int i = 0; i < 3; i++) {
    g_message_history[g_message_index][i] = central_name[i];
  }
  g_message_history[g_message_index][3] = 0x20;
  for (int i = 0; i < 16; i++) {
    g_message_history[g_message_index][4+i] = data[i];
  }
  g_message_index++;
  if(g_message_index >= 5){
    g_message_index = 0;
  }

  //表示
  drawDisplayInfo();
}

/*********************************************************************************
* Setup
*********************************************************************************/
void setup() {
  // Serial通信初期化
  Serial.begin(115200);

  //スイッチを入力に設定
  pinMode(SW1, INPUT_PULLUP);
  pinMode(SW2, INPUT_PULLUP);

  // LEDを出力に設定
  pinMode(LED_DS2, OUTPUT);
  pinMode(LED_DS3, OUTPUT);
  pinMode(LED_DS4, OUTPUT);
  pinMode(LED_DS5, OUTPUT);
  digitalWrite(LED_DS2, 0);
  digitalWrite(LED_DS3, 0);
  digitalWrite(LED_DS4, 0);
  digitalWrite(LED_DS5, 0);
  // IOを設定
  pinMode(GPIO2, OUTPUT);
  pinMode(GPIO3, OUTPUT);
  pinMode(GPIO4, OUTPUT);
  pinMode(GPIO5, OUTPUT);
  pinMode(GPIO12, OUTPUT);
  pinMode(GPIO13, OUTPUT);
  pinMode(GPIO14, OUTPUT);
  pinMode(GPIO15, OUTPUT);
  pinMode(GPIO16, OUTPUT);
  digitalWrite(GPIO2, 0);
  digitalWrite(GPIO3, 0);
  digitalWrite(GPIO4, 0);
  digitalWrite(GPIO5, 0);
  digitalWrite(GPIO12, 0);
  digitalWrite(GPIO13, 0);
  digitalWrite(GPIO14, 0);
  digitalWrite(GPIO15, 0);
  digitalWrite(GPIO16, 0);

  // ディスプレイの初期化
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);  // ディスプレイの表示に必要な電圧を生成, アドレスは 0x3C
  display.clearDisplay();  // ディスプレイのバッファを初期化
  display.setTextColor(WHITE);  // Color White
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("start");
  display.display();       // ディスプレイのバッファを表示

  // 加速度センサの初期化
  accel.init(SCALE_2G);

  // 温度センサの初期化
  temp.init();

  bleConfigure(0);

  bleSetupServicePsdi();
  bleSetupServiceDevice();
  bleSetupServiceUser();
  bleStartAdvertising();

  Serial.println("Initial done");
}

void loop() {
}
