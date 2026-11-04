// app.js
// 论文速览的小逻辑。没有用任何库，都是自己手写的。
// 思路：分句 -> 统计词频 -> 给每句打分 -> 取分最高的几句。
// TODO: 以后有空接一个真正的大模型接口，现在这个只能算词频摘要。

var inputEl = document.getElementById('input');
var runBtn = document.getElementById('run');
var sampleBtn = document.getElementById('sampleBtn');
var exportBtn = document.getElementById('exportBtn');
var historyLink = document.getElementById('historyLink');
var langEl = document.getElementById('lang');

var resultEl = document.getElementById('result');
var summaryEl = document.getElementById('summary');
var keywordEl = document.getElementById('keywords');
var statsEl = document.getElementById('stats');

// 这些词不参与关键词统计，不然出来的全是“本文”“研究”这种
var STOP_WORDS = [
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'this', 'that', 'these',
  'those', 'we', 'our', 'they', 'their', 'as', 'by', 'at', 'from', 'can',
  'may', 'also', 'has', 'have', 'had', 'not', 'but', 'which', 'such',
  'using', 'used', 'based', 'paper', 'study', 'method', 'methods', 'result',
  'results', 'proposed', 'propose',
  '本文', '我们', '研究', '方法', '结果', '可以', '一个', '以及', '通过',
  '进行', '使用', '基于', '但是', '因此', '如果', '这个', '这些', '那些',
  '他们', '其中', '并且', '目前', '主要', '问题', '提出', '一种'
];

var SAMPLE_TEXT = '随着深度学习的快速发展，基于注意力机制的模型在自然语言处理领域取得了显著进展。' +
  '然而，现有方法在处理长文本时仍然面临计算复杂度高和上下文丢失的问题。' +
  '本文提出了一种轻量级的分层注意力网络，通过局部窗口和全局摘要向量相结合的方式降低计算开销。' +
  '在三个公开数据集上的实验结果表明，该方法在保持准确率的同时将推理速度提升了约百分之四十。' +
  '消融实验进一步验证了各模块的有效性。';

// 按中英文标点分句。英文的 "et al." 这种会被切坏，暂时不管了。
function splitSentences(text) {
  var cleaned = text.replace(/\r/g, '').replace(/\n+/g, ' ');
  var parts = cleaned.split(/(?<=[。！？!?\.])\s*/);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var s = parts[i].trim();
    if (s.length > 6) {
      out.push(s);
    }
  }
  return out;
}

// 把句子切成词。英文直接按空格和符号切；
// 中文没有分词库，就两个字两个字切，很土但能用。
function cutWords(sentence) {
  var lower = sentence.toLowerCase();
  var en = lower.match(/[a-z][a-z\-]{2,}/g) || [];
  var zh = sentence.match(/[一-龥]{2}/g) || [];
  return en.concat(zh);
}

// 统计整段文本的词频
function countWords(sentences) {
  var freq = {};
  for (var i = 0; i < sentences.length; i++) {
    var words = cutWords(sentences[i]);
    for (var j = 0; j < words.length; j++) {
      var w = words[j];
      if (STOP_WORDS.indexOf(w) !== -1) {
        continue;
      }
      if (freq[w]) {
        freq[w] = freq[w] + 1;
      } else {
        freq[w] = 1;
      }
    }
  }
  return freq;
}

// 句子得分 = 句中不重复词的词频之和 / 句子长度的平方根
// 除了平方根是为了别让长句子占太大便宜，这个公式是拍脑袋想的。
function scoreSentence(sentence, freq) {
  var words = cutWords(sentence);
  if (words.length === 0) {
    return 0;
  }
  var seen = {};
  var total = 0;
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (seen[w]) {
      continue;
    }
    seen[w] = true;
    total = total + (freq[w] || 0);
  }
  return total / Math.sqrt(sentence.length);
}

// 选出得分最高的 n 句，输出时还是按原文顺序
function makeSummary(sentences, freq, n) {
  var scored = [];
  for (var i = 0; i < sentences.length; i++) {
    scored.push({
      text: sentences[i],
      score: scoreSentence(sentences[i], freq),
      index: i
    });
  }
  scored.sort(function (a, b) {
    return b.score - a.score;
  });
  var top = scored.slice(0, n);
  top.sort(function (a, b) {
    return a.index - b.index;
  });
  return top;
}

function getKeywords(freq, n) {
  var arr = [];
  for (var w in freq) {
    arr.push({ word: w, count: freq[w] });
  }
  arr.sort(function (a, b) {
    return b.count - a.count;
  });
  return arr.slice(0, n);
}

function render(picked, keywords, statsText) {
  summaryEl.innerHTML = '';
  for (var i = 0; i < picked.length; i++) {
    var li = document.createElement('li');
    li.textContent = picked[i].text;
    summaryEl.appendChild(li);
  }

  keywordEl.innerHTML = '';
  for (var j = 0; j < keywords.length; j++) {
    var span = document.createElement('span');
    span.className = 'tag';
    span.textContent = keywords[j].word + ' ×' + keywords[j].count;
    keywordEl.appendChild(span);
  }

  statsEl.textContent = statsText;
  resultEl.classList.remove('hidden');
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  console.log('summary done');
}

function run() {
  var text = inputEl.value.trim();
  if (!text) {
    alert('先粘一段摘要进来吧');
    return;
  }
  if (text.length < 30) {
    alert('太短了，再多粘一点');
    return;
  }

  var start = performance.now();
  var sentences = splitSentences(text);
  if (sentences.length === 0) {
    alert('一句都没分出来，检查一下标点？');
    return;
  }

  var freq = countWords(sentences);
  var count = Math.min(3, sentences.length);
  var picked = makeSummary(sentences, freq, count);
  var keywords = getKeywords(freq, 8);
  var ms = Math.round(performance.now() - start);

  var statsText = '原文 ' + text.length + ' 字 · 共分 ' + sentences.length +
    ' 句 · 用时 ' + ms + ' ms';
  render(picked, keywords, statsText);
}

runBtn.addEventListener('click', run);

sampleBtn.addEventListener('click', function () {
  inputEl.value = SAMPLE_TEXT;
  inputEl.focus();
});

inputEl.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    run();
  }
});

// 这两个都是占位，功能还没写
exportBtn.addEventListener('click', function () {
  alert('导出功能还没做，先截图吧');
});

historyLink.addEventListener('click', function (e) {
  e.preventDefault();
  alert('历史记录还在开发中……');
});

// 语言选择框暂时不影响结果，因为算法本来就是中英文一起处理的
langEl.addEventListener('change', function () {
  console.log('lang changed to', langEl.value);
});
