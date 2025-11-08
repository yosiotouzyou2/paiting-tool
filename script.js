let pc, dataChannel, html5QrCode;
let canvas, ctx, drawing = false;
let lastX = 0, lastY = 0;
let currentColor = "rgb(0,0,0)";
let currentLineWidth = 5;
let currentAlpha = 1.0;

// ===== レイヤー管理 =====
let layers = [];
let selectedLayerIndex = 0;

// ===== ログ関数 =====
function log(msg) {
  const box = document.getElementById("log");
  box.value += msg + "\n";
  box.scrollTop = box.scrollHeight;
}

// ===== 初期化 =====
function initPeerConnection() {
  pc = new RTCPeerConnection();

  pc.onicecandidate = (e) => {
    if (e.candidate === null) log("✅ ICE gathering 完了");
  };

  pc.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannel();
  };
}

// ===== DataChannel 設定 =====
function setupDataChannel() {
  dataChannel.onopen = () => log("🔗 DataChannel オープン");
  dataChannel.onmessage = (e) => handleDataChannelMessage(e);
  dataChannel.onclose = () => log("❌ DataChannel クローズ");
}

// ===== データ受信処理 =====
function handleDataChannelMessage(event) {
  const data = JSON.parse(event.data);
  switch(data.type){
    case "draw":
      drawLineOnLayer(data.layer, data.x1, data.y1, data.x2, data.y2, false, data.color, data.lineWidth, data.alpha);
      break;
    case "erase":
      eraseLineOnLayer(data.layer, data.x1, data.y1, data.x2, data.y2, data.size, false);
      break;
    case "clear":
      layers[data.layer].ctx.clearRect(0,0,canvas.width,canvas.height);
      renderMainCanvas();
      renderLayerThumbnails();
      break;
    case "addLayer":
      addLayer(false);
      break;
    case "selectLayer":
      selectLayer(data.index,false);
      break;
    case "deleteLayer":
        if(layers.length <= 1) return; // 相手側も最後の1枚は削除しない
        layers.splice(data.index, 1);
        if(selectedLayerIndex >= layers.length) selectedLayerIndex = layers.length - 1;
        renderMainCanvas();
        renderLayerThumbnails();
        break;
    case "changePen":
      if(syncPenSettings) {
        currentColor = data.color;
        currentLineWidth = data.lineWidth;
        currentAlpha = data.alpha;
        updatePreview();
      }
      break;
  }
}

// ===== WebRTC Offer/Answer =====
async function createOffer() {
  initPeerConnection();
  dataChannel = pc.createDataChannel("draw");
  setupDataChannel();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  displayQr(JSON.stringify(pc.localDescription));
  log("📤 Offer を生成しました。相手にQRを見せてください。");
}

async function scanOffer() {
  const readerDiv = document.getElementById("reader");
  readerDiv.style.display = "block";
  html5QrCode = new Html5Qrcode("reader");
  await html5QrCode.start({ facingMode: "environment" }, {}, async (text) => {
    log("📷 Offer 読み取り成功");
    hideQrAreas();
    await html5QrCode.stop();
    document.getElementById("reader").innerHTML = "";
    const offer = JSON.parse(text);
    await createAnswer(offer);
  });
}

async function createAnswer(offer) {
  initPeerConnection();
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  displayQr(JSON.stringify(pc.localDescription));
  log("📤 Answer を生成しました。相手にQRを見せてください。");
}

async function applyAnswer(answerText) {
  const answer = JSON.parse(answerText);
  await pc.setRemoteDescription(answer);
  hideQrAreas();
  log("✅ 接続完了！描画を共有できます。");
}

// ===== QR表示/非表示 =====
function displayQr(text) {
  const area = document.getElementById("qr-area");
  area.innerHTML = "";
  const canvasQR = document.createElement("canvas");
  area.appendChild(canvasQR);
  QRCode.toCanvas(canvasQR, text, { width: 300 });
  canvasQR.addEventListener("click", () => {
    const answerText = prompt("相手からもらったQRテキストを貼り付けてください:");
    if(answerText) applyAnswer(answerText);
  });
}

function hideQrAreas() {
  document.getElementById("qr-area").style.display = "none";
  document.getElementById("reader").style.display = "none";
  log("🙈 QRコードを非表示にしました。");
}

// ===== レイヤー処理 =====
function addLayer(send=true) {
  const layerCanvas = document.createElement("canvas");
  layerCanvas.width = canvas.width;
  layerCanvas.height = canvas.height;
  const layerCtx = layerCanvas.getContext("2d");
  layers.push({canvas: layerCanvas, ctx: layerCtx});
  selectLayer(layers.length-1,false);
  renderMainCanvas();
  renderLayerThumbnails();
  if(send && dataChannel && dataChannel.readyState==="open") {
    dataChannel.send(JSON.stringify({type:"addLayer"}));
  }
}

function selectLayer(index,send=true){
  if(index<0 || index>=layers.length) return;
  selectedLayerIndex=index;
  renderLayerThumbnails();
  if(send && dataChannel && dataChannel.readyState==="open"){
    dataChannel.send(JSON.stringify({type:"selectLayer", index}));
  }
}

function renderMainCanvas(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  layers.forEach(l=>{
    ctx.globalAlpha=1.0;
    ctx.globalCompositeOperation="source-over";
    ctx.drawImage(l.canvas,0,0);
  });
}

function renderLayerThumbnails(){
  const container = document.getElementById("layer-thumbnails");
  if(!container) return;
  container.innerHTML="";
  layers.forEach((l,i)=>{
    const thumb = document.createElement("canvas");
    thumb.width=80;
    thumb.height=80;
    const tCtx = thumb.getContext("2d");
    tCtx.drawImage(l.canvas,0,0,80,80);
    thumb.style.border=i===selectedLayerIndex?"2px solid red":"1px solid #333";
    thumb.style.margin="4px";
    thumb.addEventListener("click",()=>selectLayer(i));
    container.appendChild(thumb);
  });
}

// ===== 描画処理 =====
let syncPenSettings = true;

function drawLineOnLayer(layerIndex,x1,y1,x2,y2,send=true,color=currentColor,lineWidth=currentLineWidth,alpha=currentAlpha){
  const lctx = layers[layerIndex].ctx;
  lctx.strokeStyle=color;
  lctx.lineWidth=lineWidth;
  lctx.lineCap="round";
  lctx.globalAlpha=alpha;
  lctx.beginPath();
  lctx.moveTo(x1,y1);
  lctx.lineTo(x2,y2);
  lctx.stroke();
  renderMainCanvas();
  renderLayerThumbnails();
  if(send && dataChannel && dataChannel.readyState==="open"){
    dataChannel.send(JSON.stringify({
      type:"draw", layer:layerIndex, x1, y1, x2, y2, color, lineWidth, alpha
    }));
  }
}

function eraseLineOnLayer(layerIndex,x1,y1,x2,y2,size=currentEraserSize,send=true){
  const lctx = layers[layerIndex].ctx;
  lctx.save();
  lctx.globalCompositeOperation="destination-out";
  lctx.lineWidth=size;
  lctx.lineCap="round";
  lctx.beginPath();
  lctx.moveTo(x1,y1);
  lctx.lineTo(x2,y2);
  lctx.stroke();
  lctx.restore();
  renderMainCanvas();
  renderLayerThumbnails();
  if(send && dataChannel && dataChannel.readyState==="open"){
    dataChannel.send(JSON.stringify({type:"erase", layer:layerIndex, x1,y1,x2,y2,size}));
  }
}

// ===== Canvas初期化 =====
function setupCanvas(){
  canvas=document.getElementById("canvas");
  ctx=canvas.getContext("2d");

  const startDraw=(x,y)=>{drawing=true;lastX=x;lastY=y;};
  const draw=(x,y)=>{
    if(!drawing) return;
    if(isErasing){
      eraseLineOnLayer(selectedLayerIndex,lastX,lastY,x,y,currentEraserSize);
    }else{
      drawLineOnLayer(selectedLayerIndex,lastX,lastY,x,y);
    }
    lastX=x; lastY=y;
  };
  const stopDraw=()=>drawing=false;

  canvas.addEventListener("mousedown",e=>startDraw(e.offsetX,e.offsetY));
  canvas.addEventListener("mousemove",e=>draw(e.offsetX,e.offsetY));
  canvas.addEventListener("mouseup",stopDraw);
  canvas.addEventListener("mouseleave",stopDraw);
  canvas.addEventListener("touchstart",e=>{
    const rect=canvas.getBoundingClientRect();
    const t=e.touches[0];
    startDraw(t.clientX-rect.left,t.clientY-rect.top);
  });
  canvas.addEventListener("touchmove",e=>{
    e.preventDefault();
    const rect=canvas.getBoundingClientRect();
    const t=e.touches[0];
    draw(t.clientX-rect.left,t.clientY-rect.top);
  });
  canvas.addEventListener("touchend",stopDraw);
}

// ===== ツール切替 =====
let isErasing=false;
function setTool(tool){
  if(tool==="pen"){isErasing=false; ctx.globalCompositeOperation="source-over";}
  else if(tool==="eraser"){isErasing=true; ctx.globalCompositeOperation="source-over";}
  document.querySelectorAll('.tool-panel').forEach(p=>p.classList.add('hidden'));
  const panel=document.getElementById(`${tool}-panel`);
  if(panel) panel.classList.remove('hidden');
}

// ===== ペン設定同期 =====
const rgbInput = document.getElementById("rgb-input");   // 0,0,0入力欄
const colorPicker = document.getElementById("color-picker"); // カラーピッカー
const colorPreview = document.getElementById("color-preview");

// RGB入力欄が変わったとき
rgbInput.addEventListener('input', ()=>{
  const parts = rgbInput.value.split(',').map(s => parseInt(s.trim()));
  if(parts.length !== 3) return;
  
  const r = Math.min(255, Math.max(0, parts[0] || 0));
  const g = Math.min(255, Math.max(0, parts[1] || 0));
  const b = Math.min(255, Math.max(0, parts[2] || 0));

  currentColor = `rgb(${r},${g},${b})`;
  updatePreview();
  // カラーピッカーも更新
  colorPicker.value = rgbToHex(currentColor);

  if(syncPenSettings && dataChannel && dataChannel.readyState==="open"){
    dataChannel.send(JSON.stringify({
      type:"changePen",
      color:currentColor,
      lineWidth:currentLineWidth,
      alpha:currentAlpha
    }));
  }
});

// カラーピッカーが変わったとき
colorPicker.addEventListener('input', (e)=>{
  currentColor = e.target.value; // #RRGGBB形式
  updatePreview();

  // RGB入力欄も更新
  const r = parseInt(currentColor.slice(1,3),16);
  const g = parseInt(currentColor.slice(3,5),16);
  const b = parseInt(currentColor.slice(5,7),16);
  rgbInput.value = `${r},${g},${b}`;

  if(syncPenSettings && dataChannel && dataChannel.readyState==="open"){
    dataChannel.send(JSON.stringify({
      type:"changePen",
      color:currentColor,
      lineWidth:currentLineWidth,
      alpha:currentAlpha
    }));
  }
});

// カラーパレットクリック時
document.querySelectorAll('.color').forEach(c=>{
  c.addEventListener('click', ()=>{
    currentColor = c.dataset.color;
    const [r,g,b] = currentColor.match(/\d+/g);
    rgbInput.value = `${r},${g},${b}`;
    colorPicker.value = rgbToHex(currentColor);
    updatePreview();

    if(syncPenSettings && dataChannel && dataChannel.readyState==="open"){
      dataChannel.send(JSON.stringify({
        type:"changePen",
        color:currentColor,
        lineWidth:currentLineWidth,
        alpha:currentAlpha
      }));
    }
  });
});

function updatePreview(){
  colorPreview.style.backgroundColor = currentColor;
}

// rgb(r,g,b) を #RRGGBB に変換
function rgbToHex(rgb){
  const [r,g,b] = rgb.match(/\d+/g).map(Number);
  return "#" + ((1<<24) + (r<<16) + (g<<8) + b).toString(16).slice(1);
}



// 太さスライダー
const sizeValue=document.getElementById("size-value");
document.getElementById("size-slider").addEventListener("input",e=>{
  currentLineWidth=parseInt(e.target.value);
  sizeValue.textContent=currentLineWidth.toFixed(2);
  if(syncPenSettings && dataChannel && dataChannel.readyState==="open"){
    dataChannel.send(JSON.stringify({type:"changePen", color:currentColor, lineWidth:currentLineWidth, alpha:currentAlpha}));
  }
});

// 透明度スライダー
const alphaValue=document.getElementById("alpha-value");
document.getElementById("alpha-slider").addEventListener("input",e=>{
  currentAlpha=parseFloat(e.target.value);
  alphaValue.textContent=currentAlpha.toFixed(2);
  if(syncPenSettings && dataChannel && dataChannel.readyState==="open"){
    dataChannel.send(JSON.stringify({type:"changePen", color:currentColor, lineWidth:currentLineWidth, alpha:currentAlpha}));
  }
});

// ===== 消しゴム =====
let currentEraserSize=10;
const eraserValue=document.getElementById("eraser-value");
const eraserSlider=document.getElementById("eraser-slider");
const eraserPreview=document.getElementById("eraser-preview");
eraserSlider.addEventListener("input",(e)=>{
  currentEraserSize=parseFloat(e.target.value);
  eraserValue.textContent=currentEraserSize.toFixed(1);
  eraserPreview.style.width=currentEraserSize+"px";
  eraserPreview.style.height=currentEraserSize+"px";
});

// ===== 全消去 =====
document.getElementById("all-delete").addEventListener("click",()=>{
  layers[selectedLayerIndex].ctx.clearRect(0,0,canvas.width,canvas.height);
  renderMainCanvas();
  renderLayerThumbnails();
  if(dataChannel && dataChannel.readyState==="open"){
    dataChannel.send(JSON.stringify({type:"clear", layer:selectedLayerIndex}));
  }
});

// ===== レイヤー操作 =====
document.getElementById('add-layer-btn').addEventListener('click',()=>addLayer());
document.getElementById('layer-up').addEventListener('click',()=>{
  if(selectedLayerIndex<=0) return;
  const tmp=layers[selectedLayerIndex-1];
  layers[selectedLayerIndex-1]=layers[selectedLayerIndex];
  layers[selectedLayerIndex]=tmp;
  selectedLayerIndex--;
  renderMainCanvas();
  renderLayerThumbnails();
});
document.getElementById('layer-down').addEventListener('click',()=>{
  if(selectedLayerIndex>=layers.length-1) return;
  const tmp=layers[selectedLayerIndex+1];
  layers[selectedLayerIndex+1]=layers[selectedLayerIndex];
  layers[selectedLayerIndex]=tmp;
  selectedLayerIndex++;
  renderMainCanvas();
  renderLayerThumbnails();
});

// =====　レイヤー削除 =====
function deleteLayer(send=true) {
  // 最後の1枚は削除不可
  if(layers.length <= 1){
    alert("⚠ 最後のレイヤーは削除できません！");
    return;
  }

  // 確認ダイアログ
  if(!confirm("本当にこのレイヤーを削除しますか？")) return;

  // 削除
  layers.splice(selectedLayerIndex, 1);

  // 選択レイヤーの調整
  if(selectedLayerIndex >= layers.length){
    selectedLayerIndex = layers.length - 1;
  }

  renderMainCanvas();
  renderLayerThumbnails();

  // DataChannelで同期
  if(send && dataChannel && dataChannel.readyState==="open"){
    dataChannel.send(JSON.stringify({type:"deleteLayer", index:selectedLayerIndex}));
  }
}

document.getElementById('delete-layer-btn').addEventListener('click',()=>deleteLayer());

 // pngで保存
function saveAsPNG() {
  // 仮の合成用キャンバスを作る
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const exportCtx = exportCanvas.getContext("2d");

  // すべてのレイヤーを順に描画
  layers.forEach(l => {
    exportCtx.drawImage(l.canvas, 0, 0);
  });

  // PNGデータURLを作成
  const imageData = exportCanvas.toDataURL("image/png");

  // 自動ダウンロード
  const link = document.createElement("a");
  link.href = imageData;
  const now = new Date();
  const fileName = `something_painting_${now.getFullYear()}${(now.getMonth()+1)
    .toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours()
    .toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}.png`;
  link.download = fileName;
  link.click();

  log("💾 PNG画像を保存しました！");
}

document.getElementById("save-image-btn")?.addEventListener("click", saveAsPNG);


// ===== 設定同期切替 =====
document.getElementById("setting-on").addEventListener("click",()=>{syncPenSettings=true; log("✅ ペン設定も同期");});
document.getElementById("setting-off").addEventListener("click",()=>{syncPenSettings=false; log("✅ ペン設定は同期しない");});

// ===== ツールボタン =====
document.querySelectorAll('.tool-btn').forEach(btn=>{
  btn.addEventListener('click',()=>setTool(btn.dataset.tool));
});

// ===== WebRTCボタン =====
document.getElementById("create-offer").addEventListener("click",createOffer);
document.getElementById("scan-offer").addEventListener("click",scanOffer);

// ===== 起動 =====
setupCanvas();
addLayer(false); // 初期レイヤー作成
renderMainCanvas();
renderLayerThumbnails();
updatePreview();
log("something paintingへようこそ！");

const now = new Date();

const hours = now.getHours();      // 時
const minutes = now.getMinutes();  // 分
const seconds = now.getSeconds();  // 秒

log(`${hours}時${minutes}分${seconds}秒 に入室`);