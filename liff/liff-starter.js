const USER_SERVICE_UUID = "d22a87ff-d0da-437d-83eb-d931f2c37e3c";
const USER_CHARACTERISTIC_NOTIFY_UUID = "e90b4b4e-f18a-44f0-8691-b041c7fe57f2";
const USER_CHARACTERISTIC_WRITE_UUID = "112cba25-3166-48c2-bcc7-4a07a0b83b63";

const deviceUUIDSet = new Set();
const connectedUUIDSet = new Set();
const connectingUUIDSet = new Set();
const notificationUUIDSet = new Set();

let logNumber = 1;

function onScreenLog(text) {
    const logbox = document.getElementById('logbox');
    logbox.value += '#' + logNumber + '> ';
    logbox.value += text;
    logbox.value += '\n';
    logbox.scrollTop = logbox.scrollHeight;
    logNumber++;
}

window.onload = () => {
    liff.init(async () => {
        onScreenLog('LIFF initialized');
        renderVersionField();

        await liff.initPlugins(['bluetooth']);
        onScreenLog('BLE plugin initialized');

        checkAvailablityAndDo(() => {
            onScreenLog('Finding devices...');
            findDevice();
        });
    }, e => {
        flashSDKError(e);
        onScreenLog(`ERROR on getAvailability: ${e}`);
    });
}

async function checkAvailablityAndDo(callbackIfAvailable) {
    const isAvailable = await liff.bluetooth.getAvailability().catch(e => {
        flashSDKError(e);
        onScreenLog(`ERROR on getAvailability: ${e}`);
        return false;
    });
    // onScreenLog("Check availablity: " + isAvailable);

    if (isAvailable) {
        document.getElementById('alert-liffble-notavailable').style.display = 'none';
        callbackIfAvailable();
    } else {
        document.getElementById('alert-liffble-notavailable').style.display = 'block';
        setTimeout(() => checkAvailablityAndDo(callbackIfAvailable), 1000);
    }
}

// Find LINE Things device using requestDevice()
async function findDevice() {
    const device = await liff.bluetooth.requestDevice().catch(e => {
        flashSDKError(e);
        onScreenLog(`ERROR on requestDevice: ${e}`);
        throw e;
    });
    // onScreenLog('detect: ' + device.id);

    try {
        if (!deviceUUIDSet.has(device.id)) {
            deviceUUIDSet.add(device.id);
            addDeviceToList(device);
        } else {
            // TODO: Maybe this is unofficial hack > device.rssi
            document.querySelector(`#${device.id} .rssi`).innerText = device.rssi;
        }

        checkAvailablityAndDo(() => setTimeout(findDevice, 100));
    } catch (e) {
        onScreenLog(`ERROR on findDevice: ${e}\n${e.stack}`);
    }
}

// Add device to found device list
function addDeviceToList(device) {
    onScreenLog('Device found: ' + device.name);

    const deviceList = document.getElementById('device-list');
    const deviceItem = document.getElementById('device-list-item').cloneNode(true);
    deviceItem.setAttribute('id', device.id);
    deviceItem.querySelector(".device-id").innerText = device.id;
    deviceItem.querySelector(".device-name").innerText = device.name;
    deviceItem.querySelector(".rssi").innerText = device.rssi;
    deviceItem.classList.add("d-flex");
    deviceItem.addEventListener('click', () => {
        deviceItem.classList.add("active");
        try {
            connectDevice(device);
        } catch (e) {
            onScreenLog('Initializing device failed. ' + e);
        }
    });
    deviceList.appendChild(deviceItem);
}

// Select target device and connect it
function connectDevice(device) {
    onScreenLog('Device selected: ' + device.name);

    if (!device) {
        onScreenLog('No devices found. You must request a device first.');
    } else if (connectingUUIDSet.has(device.id) || connectedUUIDSet.has(device.id)) {
        onScreenLog('Already connected to this device.');
    } else {
        connectingUUIDSet.add(device.id);
        initializeCardForDevice(device);

        // Wait until the requestDevice call finishes before setting up the disconnect listner
        const disconnectCallback = () => {
            updateConnectionStatus(device, 'disconnected');
            device.removeEventListener('gattserverdisconnected', disconnectCallback);
        };
        device.addEventListener('gattserverdisconnected', disconnectCallback);

        onScreenLog('Connecting ' + device.name);
        device.gatt.connect().then(() => {
            updateConnectionStatus(device, 'connected');
            connectingUUIDSet.delete(device.id);
        }).catch(e => {
            flashSDKError(e);
            onScreenLog(`ERROR on gatt.connect(${device.id}): ${e}`);
            updateConnectionStatus(device, 'error');
            connectingUUIDSet.delete(device.id);
        });
    }
}

// Setup device information card
function initializeCardForDevice(device) {
    const template = document.getElementById('device-template').cloneNode(true);
    const cardId = 'device-' + device.id;

    template.style.display = 'block';
    template.setAttribute('id', cardId);
    template.querySelector('.card > .card-header > .device-name').innerText = device.name;

    //----追加分ここから----
    template.querySelector('.settext').addEventListener('click', () => {
        writeText(device, template.querySelector('.write_text').value).catch(e => onScreenLog(`ERROR on writeText(): ${e}\n${e.stack}`));
    });
    //----ここまで----

    // Device disconnect button
    template.querySelector('.device-disconnect').addEventListener('click', () => {
        onScreenLog('Clicked disconnect button');
        device.gatt.disconnect();
    });

    template.querySelector('.setuuid').addEventListener('click', () => {

        writeAdvertuuid(device, template.querySelector('.uuid_text').value).catch(e => onScreenLog(`ERROR on writeAdvertuuid(): ${e}\n${e.stack}`));
    });


    // Tabs
    ['notify', 'write', 'advert'].map(key => {
        const tab = template.querySelector(`#nav-${key}-tab`);
        const nav = template.querySelector(`#nav-${key}`);

        tab.id = `nav-${key}-tab-${device.id}`;
        nav.id = `nav-${key}-${device.id}`;

        tab.href = '#' + nav.id;
        tab['aria-controls'] = nav.id;
        nav['aria-labelledby'] = tab.id;
    })

    // Remove existing same id card
    const oldCardElement = getDeviceCard(device);
    if (oldCardElement && oldCardElement.parentNode) {
        oldCardElement.parentNode.removeChild(oldCardElement);
    }

    document.getElementById('device-cards').appendChild(template);
    onScreenLog('Device card initialized: ' + device.name);
}

// Update Connection Status
function updateConnectionStatus(device, status) {
    if (status == 'connected') {
        onScreenLog('Connected to ' + device.name);
        connectedUUIDSet.add(device.id);

        const statusBtn = getDeviceStatusButton(device);
        statusBtn.setAttribute('class', 'device-status btn btn-outline-primary btn-sm disabled');
        statusBtn.innerText = "Connected";
        getDeviceDisconnectButton(device).style.display = 'inline-block';
        getDeviceCardBody(device).style.display = 'block';
    } else if (status == 'disconnected') {
        onScreenLog('Disconnected from ' + device.name);
        connectedUUIDSet.delete(device.id);

        const statusBtn = getDeviceStatusButton(device);
        statusBtn.setAttribute('class', 'device-status btn btn-outline-secondary btn-sm disabled');
        statusBtn.innerText = "Disconnected";
        getDeviceDisconnectButton(device).style.display = 'none';
        getDeviceCardBody(device).style.display = 'none';
        document.getElementById(device.id).classList.remove('active');
    } else {
        onScreenLog('Connection Status Unknown ' + status);
        connectedUUIDSet.delete(device.id);

        const statusBtn = getDeviceStatusButton(device);
        statusBtn.setAttribute('class', 'device-status btn btn-outline-danger btn-sm disabled');
        statusBtn.innerText = "Error";
        getDeviceDisconnectButton(device).style.display = 'none';
        getDeviceCardBody(device).style.display = 'none';
        document.getElementById(device.id).classList.remove('active');
    }
}


async function refreshValues(device) {
    const accelerometerCharacteristic = await getCharacteristic(
        device, USER_SERVICE_UUID, USER_CHARACTERISTIC_NOTIFY_UUID);

    const accelerometerBuffer = await readCharacteristic(accelerometerCharacteristic).catch(e => {
        return null;
    });

    if (accelerometerBuffer !== null) {
        updateSensorValue(device, accelerometerBuffer);
    }
}

function updateSensorValue(device, buffer) {
    const temperature = buffer.getInt16(0, true) / 100.0;
    const accelX = buffer.getInt16(2, true) / 1000.0;
    const accelY = buffer.getInt16(4, true) / 1000.0;
    const accelZ = buffer.getInt16(6, true) / 1000.0;
    const sw1 = buffer.getInt16(8, true);
    const sw2 = buffer.getInt16(10, true);

    getDeviceProgressBarX(device).style.width = (accelX / 4 * 100 + 50) + "%";
    getDeviceProgressBarY(device).style.width = (accelY / 4 * 100 + 50) + "%";
    getDeviceProgressBarZ(device).style.width = (accelZ / 4 * 100 + 50) + "%";
    getDeviceProgressBarTemperature(device).innerText = temperature + "℃";
    getDeviceProgressBarX(device).innerText = accelX;
    getDeviceProgressBarY(device).innerText = accelY;
    getDeviceProgressBarZ(device).innerText = accelZ;
    getDeviceStatusSw1(device).innerText = (sw1 == 0x0001)? "ON" : "OFF";
    getDeviceStatusSw2(device).innerText = (sw2 == 0x0001)? "ON" : "OFF";
}

async function readCharacteristic(characteristic) {
    const response = await characteristic.readValue().catch(e => {
        onScreenLog(`Error reading ${characteristic.uuid}: ${e}`);
        throw e;
    });
    if (response) {
        onScreenLog(`Read ${characteristic.uuid}: ${buf2hex(response.buffer)}`);
        const values = new DataView(response.buffer);
        return values;
    } else {
        throw 'Read value is empty?';
    }
}


async function writeText(device, text) {
  let ch_array = text.split("");
  for(let i = 0; i < 16; i = i + 1){
    ch_array[i] = (new TextEncoder('ascii')).encode(ch_array[i]);
  }

  onScreenLog('Write text to device  : ' + new Uint8Array(ch_array));

  const characteristic = await getCharacteristic(
        device, USER_SERVICE_UUID, USER_CHARACTERISTIC_WRITE_UUID);
  await characteristic.writeValue(new Uint8Array(ch_array)).catch(e => {
      onScreenLog(`Error writing ${characteristic.uuid}: ${e}`);
      throw e;
  });
}

async function writeAdvertuuid(device, uuid) {
  const tx_uuid = uuid.replace(/-/g, '');
  let uuid_byte = [];
  let hash = 0;
  for(let i = 0; i < 16; i = i + 1) {
    uuid_byte[i] = parseInt(tx_uuid.substring(i * 2, i * 2 + 2), 16);
    hash = hash + uuid_byte[i];
  }

  const header = [1, 0, 0, hash];
  const command = header.concat(uuid_byte);

  onScreenLog('Write new advert UUID to device  : ' + new Uint8Array(command));

  const characteristic = await getCharacteristic(
        device, USER_SERVICE_UUID, USER_CHARACTERISTIC_WRITE_UUID);
  await characteristic.writeValue(new Uint8Array(command)).catch(e => {
      onScreenLog(`Error writing ${characteristic.uuid}: ${e}`);
      throw e;
  });
}


async function getCharacteristic(device, serviceId, characteristicId) {
    const service = await device.gatt.getPrimaryService(serviceId).catch(e => {
        flashSDKError(e);
        throw e;
    });
    const characteristic = await service.getCharacteristic(characteristicId).catch(e => {
        flashSDKError(e);
        throw e;
    });
    onScreenLog(`Got characteristic ${serviceId} ${characteristicId} ${device.id}`);
    return characteristic;
}

function getDeviceCard(device) {
    return document.getElementById('device-' + device.id);
}

function getDeviceCardBody(device) {
    return getDeviceCard(device).getElementsByClassName('card-body')[0];
}

function getDeviceStatusButton(device) {
    return getDeviceCard(device).getElementsByClassName('device-status')[0];
}

function getDeviceDisconnectButton(device) {
    return getDeviceCard(device).getElementsByClassName('device-disconnect')[0];
}

function getDeviceProgressBarTemperature(device) {
    return getDeviceCard(device).getElementsByClassName('progress-bar-temperature')[0];
}

function getDeviceProgressBarX(device) {
    return getDeviceCard(device).getElementsByClassName('progress-bar-x')[0];
}

function getDeviceProgressBarY(device) {
    return getDeviceCard(device).getElementsByClassName('progress-bar-y')[0];
}

function getDeviceProgressBarZ(device) {
    return getDeviceCard(device).getElementsByClassName('progress-bar-z')[0];
}

function getDeviceStatusSw1(device) {
    return getDeviceCard(device).getElementsByClassName('sw1-value')[0];
}
function getDeviceStatusSw2(device) {
    return getDeviceCard(device).getElementsByClassName('sw2-value')[0];
}

function getDeviceNotificationButton(device) {
    return getDeviceCard(device).getElementsByClassName('notification-enable')[0];
}

function renderVersionField() {
    const element = document.getElementById('sdkversionfield');
    const versionElement = document.createElement('p')
        .appendChild(document.createTextNode('SDK Ver: ' + liff._revision));
    element.appendChild(versionElement);
}

function flashSDKError(error){
    window.alert('SDK Error: ' + error.code);
    window.alert('Message: ' + error.message);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function buf2hex(buffer) { // buffer is an ArrayBuffer
    return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}
