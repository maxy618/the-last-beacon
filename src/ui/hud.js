// ---------------------------------------------------------------------------
// Heads-up display: prompts, subtitles, the objective line, toasts and the
// performance read-out. Pure DOM so it stays crisp at any resolution.
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.crosshair = $('crosshair');
    this.prompt = $('prompt');
    this.subtitle = $('subtitle');
    this.objective = $('objective');
    this.objText = $('objText');
    this.toast = $('toast');
    this.toastT = this.toast.querySelector('.t');
    this.toastS = this.toast.querySelector('.s');
    this.stats = $('stats');
    this.vignette = $('vignette');
    this.damage = $('damage');
    this.fade = $('fade');
    this._subTimer = 0;
    this._toastTimer = 0;
    this._promptText = '';
    this._promptKey = '';
  }

  setCrosshair(visible, hot = false) {
    this.crosshair.classList.toggle('show', visible);
    this.crosshair.classList.toggle('hot', hot);
  }

  setPrompt(key, text) {
    if (text === this._promptText && key === this._promptKey) return;
    this._promptText = text; this._promptKey = key;
    if (!text) { this.prompt.classList.remove('show'); return; }
    this.prompt.innerHTML = key ? `<b>${key}</b>${text}` : text;
    this.prompt.classList.add('show');
  }

  say(text, who = '', seconds = 5.5) {
    this.subtitle.innerHTML = who ? `<span class="who">${who}</span>${text}` : text;
    this.subtitle.classList.add('show');
    this._subTimer = seconds;
  }

  showToast(title, sub = '', seconds = 3.4) {
    this.toastT.textContent = title;
    this.toastS.textContent = sub;
    this.toast.classList.add('show');
    this._toastTimer = seconds;
  }

  setObjective(text) {
    if (!text) { this.objective.classList.remove('show'); this._obj = text; return; }
    if (this._obj === text) return;
    this._obj = text;
    this.objText.textContent = text;
    this.objective.classList.add('show');
  }

  setStats(text) { this.stats.textContent = text; }
  toggleStats(on) { this.stats.classList.toggle('show', on); }

  flashDamage() {
    this.damage.classList.add('on');
    setTimeout(() => this.damage.classList.remove('on'), 140);
  }

  setFade(on) { this.fade.classList.toggle('on', on); }

  update(dt) {
    if (this._subTimer > 0) {
      this._subTimer -= dt;
      if (this._subTimer <= 0) this.subtitle.classList.remove('show');
    }
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) this.toast.classList.remove('show');
    }
  }
}
