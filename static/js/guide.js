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
    const ttWidth = 340;
    let top = rect.bottom + 10;
    let left = Math.max(8, Math.min(rect.left, window.innerWidth - ttWidth - 8));
    tt.style.top = top + 'px';
    tt.style.left = left + 'px';
    const height = tt.offsetHeight || 160;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 10);
      tt.style.top = top + 'px';
    }
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
    const nextBtn = document.getElementById('g-next');
    // Default next behavior
    nextBtn.onclick = ()=>{ stepIndex = Math.min(steps.length-1, stepIndex+1); showStep(stepIndex); };

    // Auto-click actual buttons when appropriate
    if (i === 1) { // Submit step
      nextBtn.onclick = ()=>{
        // Simulate clicking submit to render mock evaluation immediately
        if (submitBtn) submitBtn.click();
        stepIndex = 2;
        showStep(stepIndex);
      };
    }
    if (i === 2) { // Evaluation step → before moving to rewrite, prefill answers
      nextBtn.onclick = ()=>{
        // Ensure questions are rendered
        if (rewritePopup && rewritePopup.querySelectorAll('.rewrite-answer').length === 0) {
          renderMockQuestions();
        }
        const answers = rewritePopup ? rewritePopup.querySelectorAll('.rewrite-answer') : [];
        if (answers && answers.length >= 2) {
          answers[0].value = 'HX-07, chronic fouling leading to >18% efficiency loss.';
          answers[1].value = 'Isolate, drain, swap, pressure test 16 bar, restore service; delta-T back to spec.';
        }
        stepIndex = 3;
        showStep(stepIndex);
      };
    }
    if (i === 3) { // Rewrite step
      nextBtn.onclick = ()=>{
        const rw = document.getElementById('guide-rewrite');
        if (rw) {
          rw.click();
        } else {
          // Fallback: apply improved text directly
          const improved = 'Heat exchanger replacement: Replace HX-07 due to chronic fouling causing efficiency loss >18%. Plan: isolate, drain, swap unit, pressure test to 16 bar, restore service. Expected outcome: restore delta-T to spec and reduce energy draw.';
          editor.innerText = improved;
          rewritePopup.style.display = 'none';
          evalBox.style.display = 'none';
        }
        stepIndex = Math.min(steps.length-1, stepIndex+1);
        showStep(stepIndex);
      };
    }
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
          <div class="llm-section-header" tabindex="0">
            <span class="llm-dropdown-arrow open">▶</span>
            <span class="llm-section-title" style="color:#111;"><strong>includes_relevant_context</strong></span>
            <span class="llm-feedback-btn" title="Give feedback" data-criteria="includes_relevant_context">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="thumbs-down-icon" viewBox="0 0 16 16">
                <path d="M8.864 15.674c-.956.24-1.843-.484-1.908-1.42-.072-1.05-.23-2.015-.428-2.59-.125-.36-.479-1.012-1.04-1.638-.557-.624-1.282-1.179-2.131-1.41C2.685 8.432 2 7.85 2 7V3c0-.845.682-1.464 1.448-1.546 1.07-.113 1.564-.415 2.068-.723l.048-.029c.272-.166.578-.349.97-.484C6.931.08 7.395 0 8 0h3.5c.937 0 1.599.478 1.934 1.064.164.287.254.607.254.913 0 .152-.023.312-.077.464.201.262.38.577.488.9.11.33.172.762.004 1.15.069.13.12.268.159.403.077.27.113.567.113.856s-.036.586-.113.856c-.035.12-.08.244-.138.363.394.571.418 1.2.234 1.733-.206.592-.682 1.1-1.2 1.272-.847.283-1.803.276-2.516.211a10 10 0 0 1-.443-.05 9.36 9.36 0 0 1-.062 4.51c-.138.508-.55.848-1.012.964zM11.5 1H8c-.51 0-.863.068-1.14.163-.281.097-.506.229-.776.393l-.04.025c-.555.338-1.198.73-2.49.868-.333.035-.554.29-.554.55V7c0 .255.226.543.62.65 1.095.3 1.977.997 2.614 1.709.635.71 1.064 1.475 1.238 1.977.243.7.407 1.768.482 2.85.025.362.36.595.667.518l.262-.065c.16-.04.258-.144.288-.255a8.34 8.34 0 0 0-.145-4.726.5.5 0 0 1 .595-.643h.003l.014.004.058.013a9 9 0 0 0 1.036.157c.663.06 1.457.054 2.11-.163.175-.059.45-.301.57-.651.107-.308.087-.67-.266-1.021L12.793 7l.353-.354c.043-.042.105-.14.154-.315.048-.167.075-.37.075-.581s-.027-.414-.075-.581c-.05-.174-.111-.273-.154-.315l-.353-.354.353-.354c.047-.047.109-.176.005-.488a2.2 2.2 0 0 0-.505-.804l-.353-.354.353-.354c.006-.005.041-.05.041-.17a.9.9 0 0 0-.121-.415C12.4 1.272 12.063 1 11.5 1"/>
              </svg>
            </span>
          </div>
          <div class="llm-section-justification" style="display:block;">Include model (HX-07), location, failure impact, and acceptance criteria.</div>
        </div>
        <div class="llm-section llm-dropdown" data-passed="true">
          <div class="llm-section-header" tabindex="0"><span class="llm-dropdown-arrow">▶</span><span class="llm-section-title" style="color:#111;"><strong>uses_professional_language</strong></span></div>
          <div class="llm-section-justification" style="display:none;">Good tone and clarity.</div>
        </div>
      </div>
    `;
    // Basic dropdown & feedback interactions matching app styling
    const content = document.getElementById('guide-eval-content');
    if (content) {
      content.querySelectorAll('.llm-section-header').forEach(header => {
        header.addEventListener('click', () => {
          const section = header.closest('.llm-dropdown');
          const just = section.querySelector('.llm-section-justification');
          const arrow = header.querySelector('.llm-dropdown-arrow');
          const open = !section.classList.contains('open');
          section.classList.toggle('open', open);
          just.style.display = open ? 'block' : 'none';
          arrow.classList.toggle('open', open);
        });
      });
      const fb = content.querySelector('.llm-feedback-btn');
      if (fb) {
        fb.addEventListener('click', (e) => {
          e.stopPropagation();
          const card = fb.closest('.llm-section');
          let box = card.querySelector('.llm-feedback-box');
          if (box) { box.remove(); fb.classList.remove('selected'); return; }
          fb.classList.add('selected');
          box = document.createElement('div');
          box.className = 'llm-feedback-box';
          box.style.marginTop = '0px';
          box.innerHTML = `<textarea class="llm-feedback-text" rows="1" placeholder="Please Give Feedback"></textarea><button class="llm-feedback-submit" title="Send Feedback"> <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><line x1='22' y1='2' x2='11' y2='13'/><polygon points='22 2 15 22 11 13 2 9 22 2'/></svg></button>`;
          card.appendChild(box);
        });
      }
    }
  }

  function renderMockQuestions(){
    rewritePopup.style.display = 'block';
    rewritePopup.innerHTML = `
      <div class="rewrite-title" style="font-weight:700;color:#41007F;margin-bottom:8px;">To improve your input, please answer the following questions:</div>
      <div style="border:2px solid #41007F;background:rgba(240,240,255,0.3);border-radius:10px;padding:18px 18px 10px 18px;margin:10px 0;">
        <div class="rewrite-question">Which exchanger is being replaced and why?</div>
        <textarea class="rewrite-answer" rows="1" style="width:100%;margin-bottom:12px;resize:none;"></textarea>
        <div class="rewrite-question">What is the procedure and acceptance criteria?</div>
        <textarea class="rewrite-answer" rows="1" style="width:100%;margin-bottom:12px;resize:none;"></textarea>
        <button id="guide-rewrite" class="llm-submit-button" style="margin-top:10px;">Rewrite</button>
      </div>
    `;
  }

  function renderMockHistory(){
    history.innerHTML = '';
    const item = document.createElement('li');
    item.className = 'history-item';
    item.style.border = '2px solid #FFC107';
    item.innerHTML = `<div style="white-space:pre-wrap;">Heat exchanger replacement</div>`;
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
      const improved = 'Heat exchanger replacement: Replace HX-07 due to chronic fouling causing efficiency loss >18%. Plan: isolate, drain, swap unit, pressure test to 16 bar, restore service. Expected outcome: restore delta-T to spec and reduce energy draw.';
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


