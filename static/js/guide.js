(function(){
  const steps = [
    {
      target: '#guide-editor',
      text: 'Type or paste your problem statement here. We pre-filled an example for this guide.'
    },
    {
      target: '#guide-submit',
      text: 'Click “Submit for Review” to score your text and see how to improve.'
    },
    {
      target: '#guide-eval-box',
      text: 'Open the evaluation to see criteria. “Needs Improvement” shows where to focus.'
    },
    {
      target: '#guide-rewrite-popup',
      text: 'Answer rewrite questions to provide missing context. Then click “Rewrite”.'
    }
  ];

  const overlay = document.getElementById('guide-overlay');
  const tooltip = document.getElementById('guide-tooltip');
  const editor = document.getElementById('guide-editor');
  const submitBtn = document.getElementById('guide-submit');
  const evalBox = document.getElementById('guide-eval-box');
  const rewritePopup = document.getElementById('guide-rewrite-popup');
  const history = document.getElementById('guide-history');

  let stepIndex = 0;

  function positionTooltip(targetEl){
    if (!targetEl) return;
    const rect = targetEl.getBoundingClientRect();
    const tt = tooltip;
    const top = rect.bottom + 10;
    const left = Math.min(rect.left, window.innerWidth - 340);
    tt.style.top = top + 'px';
    tt.style.left = left + 'px';
  }

  function setHighlight(target){
    document.querySelectorAll('.guide-highlight').forEach(e=>e.classList.remove('guide-highlight'));
    if (target) target.classList.add('guide-highlight');
  }

  function showStep(i){
    const s = steps[i];
    if (!s) { hideGuide(); return; }
    const target = document.querySelector(s.target);
    overlay.style.display = 'block';
    tooltip.style.display = 'block';
    tooltip.innerHTML = `<div>${s.text}</div><div class="guide-ctrls"><button class="guide-btn secondary" id="g-prev">Back</button><button class="guide-btn" id="g-next">Next</button></div>`;
    setHighlight(target);
    positionTooltip(target);
    document.getElementById('g-prev').onclick = ()=>{ stepIndex = Math.max(0, stepIndex-1); showStep(stepIndex); };
    document.getElementById('g-next').onclick = ()=>{ stepIndex = Math.min(steps.length-1, stepIndex+1); showStep(stepIndex); };
  }

  function hideGuide(){
    overlay.style.display = 'none';
    tooltip.style.display = 'none';
    document.querySelectorAll('.guide-highlight').forEach(e=>e.classList.remove('guide-highlight'));
  }

  function renderMockEvaluation(){
    evalBox.style.display = 'flex';
    evalBox.innerHTML = `
      <div class="llm-score" style="font-weight:700;background:#fff;color:#41007F;padding:10px;border-radius:8px;box-shadow:0 1px 4px rgba(33,0,127,0.07);position:relative;">
        <button id="guide-eval-btn" title="Click to expand for details" style="background:rgba(65,0,127,0.05);border:none;cursor:pointer;padding:0 6px;outline:none;display:inline-flex;align-items:center;justify-content:center;position:absolute;left:8px;top:50%;width:24px;height:24px;z-index:2;border-radius:4px;">▶</button>
        <span style="margin-left:32px;font-size:1.2em;">How Your Score Was Calculated</span>
      </div>
      <div id="guide-eval-content" class="llm-eval-content" style="display:block;margin-top:12px;">
        <div class="llm-section llm-dropdown open" data-passed="false">
          <div class="llm-section-header" tabindex="0"><span class="llm-dropdown-arrow open">▶</span><span class="llm-section-title" style="color:#111;"><strong>includes_relevant_context</strong></span></div>
          <div class="llm-section-justification" style="display:block;">Add the specific test conditions and expected behavior.</div>
        </div>
        <div class="llm-section llm-dropdown" data-passed="true">
          <div class="llm-section-header" tabindex="0"><span class="llm-dropdown-arrow">▶</span><span class="llm-section-title" style="color:#111;"><strong>uses_professional_language</strong></span></div>
          <div class="llm-section-justification" style="display:none;">Good tone and clarity.</div>
        </div>
      </div>
    `;
  }

  function renderMockQuestions(){
    rewritePopup.style.display = 'block';
    rewritePopup.innerHTML = `
      <div class="rewrite-title" style="font-weight:700;color:#41007F;margin-bottom:8px;">To improve your input, please answer the following questions:</div>
      <div style="border:2px solid #41007F;background:rgba(240,240,255,0.3);border-radius:10px;padding:18px 18px 10px 18px;margin:10px 0;">
        <div class="rewrite-question">What precise temperature range triggers the failure?</div>
        <textarea class="rewrite-answer" rows="1" style="width:100%;margin-bottom:12px;resize:none;">Between 55–60°C during rapid ramp up.</textarea>
        <div class="rewrite-question">What is the expected vs actual behavior?</div>
        <textarea class="rewrite-answer" rows="1" style="width:100%;margin-bottom:12px;resize:none;">Expected: stable calibration; Actual: timeout on sensor read.</textarea>
        <button id="guide-rewrite" class="llm-submit-button" style="margin-top:10px;">Rewrite</button>
      </div>
    `;
  }

  function renderMockHistory(){
    history.innerHTML = '';
    const item = document.createElement('li');
    item.className = 'history-item';
    item.style.border = '2px solid #FFC107';
    item.innerHTML = `<div style="white-space:pre-wrap;">Sensor intermittently fails during calibration on Line 3...</div>`;
    history.appendChild(item);
  }

  // Events
  submitBtn.addEventListener('click', () => {
    renderMockEvaluation();
    renderMockQuestions();
    renderMockHistory();
    stepIndex = 2; // jump to eval step
    showStep(stepIndex);
  });

  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'guide-rewrite') {
      const improved = 'Calibrations fail on Line 3 when temperature ramps from 50→60°C within 30s. Logs indicate read timeout (1200ms). Mitigation: add debounce and extend read window to 1800ms.';
      editor.innerText = improved;
      rewritePopup.style.display = 'none';
      evalBox.style.display = 'none';
      stepIndex = steps.length - 1; // final step
      showStep(stepIndex);
    }
  });

  // Start guide after initial layout
  window.addEventListener('load', ()=>{
    showStep(stepIndex);
  });
})();


