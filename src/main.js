var items = [
  ["auto", "auto"],
  ["zh-Hans", "zh"],
  ["zh-Hant", "zh"],
  ["en", "en"],
  ["ja", "ja"],
];

// 创建用于正向和反向查找的语言映射表
var langMap = new Map(items);
var langMapReverse = new Map(
  items.map(([standardLang, lang]) => [lang, standardLang])
);

/**
 * 返回支持的语言列表。
 *
 * @return {Array<string>} 支持的语言代码列表。
 */
function supportLanguages() {
  return items.map(([standardLang, lang]) => standardLang);
}

/**
 * 设定返回超时时间
 *
 * @return {number} 超时时间，单位为秒。
 */
function pluginTimeoutInterval() {
  return 30;
}

/**
 * 主翻译函数，用于处理查询并返回结果。
 *
 * https://bobtranslate.com/plugin/quickstart/translate.html
 *
 * @param {Object} query 翻译查询对象。
 * @param {string} query.text 需要翻译的文本。
 * @param {string} query.from 用户选中的源语言代码，可能是 auto。
 * @param {string} query.to 用户选中的目标语言代码，可能是 auto。
 * @param {string} query.detectFrom 检测过后的源语言，一定不是 auto，如果插件不具备检测语言的能力，可直接使用该属性。
 * @param {string} query.detectTo 检测过后的目标语言，一定不是 auto，如果不想自行推测用户实际需要的目标语言，可直接使用该属性。
 * @param {$signal} query.cancelSignal 取消信号，可直接将此对象透传给 $http 请求用于取消，同时也可以监听此信号做一些额外的逻辑
 * @param {Function} query.onStream 流式数据回调函数。
 * @param {Function} query.onCompletion 处理响应的回调函数。
 * @return {void}
 */
function translate(query) {
  const header = {
    "Content-Type": "application/json",
    "User-Agent": "MOJiDict/20241212 CFNetwork/1568.300.101 Darwin/24.2.0",
    "X-Parse-Application-Id": "E62VyFVLMiW7kvbtVq3p",
  };

  (async () => {
    try {
      $log.info(`搜索请求 query.text: ${query.text}`);
      const searchResponse = await fetchSearchResults(query.text, header);
      const targetId = getTargetIdFromSearchResponse(searchResponse);
      if (!targetId)
        return handleError(new KnownError("notFound", "未找到结果"), query);

      const wordDetailsResponse = await fetchWordDetails(targetId, header);
      const toDict = parseWordDetails(wordDetailsResponse);
      const toTTS = await fetchTTS(targetId, header);

      $log.info(`单词详情请求结果 to_dict: ${JSON.stringify(toDict)}`);
      query.onCompletion({
        result: {
          from: query.detectFrom,
          to: query.detectTo,
          toParagraphs: [
            wordDetailsResponse.data.result.result[0].word.excerpt.replace(
              /#/g,
              "·"
            ),
          ],
          toDict: toDict,
          toTTS: toTTS,
        },
      });
    } catch (err) {
      handleError(err, query);
    }
  })();
}

/**
 * 搜索请求
 *
 * @param {string} text 要搜索的文本。
 * @param {Object} header 请求中包含的头信息。
 * @return {Promise<Object>} 搜索请求的响应对象。
 */
async function fetchSearchResults(text, header) {
  return await $http.request({
    method: "POST",
    url: "https://api.mojidict.com/parse/functions/search-all",
    header,
    timeout: 10,
    body: {
      inputMethod: 0,
      g_ver: "v8.9.0",
      g_os: "iOS",
      text: text,
      highlight: true,
      types: ["102", "103", "106", "431"],
    },
  });
}

/**
 * 搜索响应提取 targetId
 *
 * @param {Object} searchResponse 搜索请求的响应对象。
 * @return {string} 单词的 target ID。
 */
function getTargetIdFromSearchResponse(searchResponse) {
  if (!searchResponse || !searchResponse.data) {
    throw new KnownError(
      "api",
      "API 搜索接口返回数据为空",
      "请检查网络连接或 API 接口状态"
    );
  }
  if (searchResponse.error) {
    throw new KnownError(
      "api",
      `API 搜索接口响应错误 - ${searchResponse.error.localizedDescription}`,
      searchResponse.error.localizedFailureReason
    );
  }

  $log.info(`搜索请求结果 search_data: ${JSON.stringify(searchResponse.data)}`);
  const searchResult = searchResponse.data?.result?.result?.word?.searchResult;
  if (!searchResult || searchResult.length === 0) {
    throw new KnownError("notFound", "未找到结果");
  }
  if (!searchResult[0]?.targetId) {
    throw new KnownError("api", "搜索结果格式错误", "返回数据中缺少 targetId");
  }
  return searchResult[0].targetId;
}

/**
 * 获取 target ID 单词详细信息。
 *
 * @param {string} targetId 单词 target ID。
 * @param {Object} header 请求中包含的头信息。
 * @return {Promise<Object>} 包含单词详细信息的响应对象。
 */
async function fetchWordDetails(targetId, header) {
  return await $http.request({
    method: "POST",
    url: "https://api.mojidict.com/parse/functions/ui-union-apis-word",
    header,
    timeout: 10,
    body: {
      skipAccessories: false,
      objectId: targetId,
      g_os: "iOS",
      isVerb3: true,
    },
  });
}

/**
 * 从单词详情响应中解析单词详细信息。
 *
 * @param {Object} wordDetailsResponse 包含单词详细信息的响应对象。
 * @return {Object} 包含解析后单词详细信息的对象。
 */
function parseWordDetails(wordDetailsResponse) {
  if (wordDetailsResponse.error) {
    throw new KnownError(
      "api",
      `API 单词详情接口响应错误 - ${wordDetailsResponse.error.localizedDescription}`,
      wordDetailsResponse.error.localizedFailureReason
    );
  }

  const rawWordData = wordDetailsResponse.data.result;
  const wordData = rawWordData.result[0];
  const toDict = {
    word: `${wordData.word.spell} ${wordData.word.accent || ""}`,
    parts: [],
    exchanges: [],
    additions: [],
  };

  if (wordData.word.pron) {
    toDict.parts.push({
      part: "平假名",
      means: [`[${wordData.word.pron}]`],
    });
  }
  if (wordData.word.romaji) {
    toDict.parts.push({
      part: "罗马音",
      means: [`[${wordData.word.romaji}]`],
    });
  }

  if (rawWordData.thesaurus) {
    if (
      rawWordData.thesaurus.synonyms &&
      rawWordData.thesaurus.synonyms.length !== 0
    ) {
      toDict.exchanges.push({
        name: "同义词",
        words: rawWordData.thesaurus.synonyms,
      });
    }
    if (
      rawWordData.thesaurus.antonyms &&
      rawWordData.thesaurus.antonyms.length !== 0
    ) {
      toDict.exchanges.push({
        name: "反义词",
        words: rawWordData.thesaurus.antonyms,
      });
    }
  }

  toDict.exchanges.push({
    name: "原形",
    words: [rawWordData.conjugate.type],
  });
  for (const formGroup of rawWordData.conjugate.forms) {
    for (const form of formGroup) {
      toDict.exchanges.push({
        name: form.name,
        words: [form.form],
      });
    }
  }

  let definitionIndex = 1;
  const subdetailsMap = new Map(
    (wordData.subdetails || []).map((subdetail) => [
      subdetail.detailsId,
      subdetail,
    ])
  );
  const examplesMap = new Map(
    (wordData.examples || []).map((example) => [example.subdetailsId, example])
  );
  for (const detail of wordData.details || []) {
    const subdetail = subdetailsMap.get(detail.objectId);
    if (subdetail) {
      toDict.additions.push({
        name: ``,
        value: `${definitionIndex}、[${detail.title.replace(/#/g, "·")}] ${
          subdetail.title
        }`,
      });
      definitionIndex += 1;
      const example = examplesMap.get(subdetail.objectId);
      if (example) {
        toDict.additions.push({
          name: example.title,
          value: example.trans || "",
        });
      }
    }
  }

  if (wordData.word.tags) {
    const tags = wordData.word.tags.split("#");
    toDict.additions.push({
      name: "标签",
      value: tags.join(" / "),
    });
  }

  return toDict;
}

/**
 * 获取指定 target ID 的单词的 TTS 信息。
 *
 * @param {string} targetId 单词的 target ID。
 * @param {Object} header 请求中包含的头信息。
 * @return {Promise<Object>} 包含 TTS 详细信息的对象。
 */
async function fetchTTS(targetId, header) {
  const ttsResponse = await $http.request({
    method: "POST",
    url: "https://api.mojidict.com/parse/functions/tts-fetch",
    header,
    timeout: 10,
    body: {
      voiceId: "f000",
      g_os: "iOS",
      tarId: targetId,
      tarType: 102,
    },
  });

  const ttsDetails = {};
  if (!ttsResponse.error) {
    const ttsData = ttsResponse.data.result;
    if (ttsData.code === 200) {
      ttsDetails["type"] = "url";
      ttsDetails["value"] = ttsData.result.url;
    }
  }
  return ttsDetails;
}

/**
 * 自定义错误类
 * 
 * @param {'unknown'|'param'|'unsupportedLanguage'|'secretKey'|'network'|'api'|'notFound'} type 错误类型。
 * @param {string} message 错误信息。
 * @param {any=} addtion 附加信息。
 * @param {string=} troubleshootingLink 故障排除的链接。
 */
class KnownError extends Error {
  constructor(type, message, addtion, troubleshootingLink) {
    super(message);
    this.type = type;
    this.addtion = addtion;
    this.troubleshootingLink = troubleshootingLink;
  }
}

/**
 * 通用错误处理函数
 *
 * @param {Object} err 错误对象。
 * @param {'unknown'|'param'|'unsupportedLanguage'|'secretKey'|'network'|'api'|'notFound'} err.type 错误类型。可设置为 未知错误|参数错误|不支持的语言|未设置秘钥|请求服务器异常|服务异常|未查询到结果。
 * @param {string} err.message 错误信息。
 * @param {any=} err.addtion 附加信息。
 * @param {string=} err.troubleshootingLink 故障排除的链接。
 * @param {Function} query 处理响应的回调函数。
 * @return {void}
 */
function handleError(err, query) {
  if (!err.type) {
    err.type = "unknown";
    err.message =
      err.message +
      "\n\n请尝试重新查询或联系我们。\nhttps://github.com/Ukenn2112/MOJiBobPlugin/issues/new";
  }
  query.onCompletion({
    error: {
      type: err.type,
      message: "出现错误: " + err.message,
      addtion: err.addtion,
      troubleshootingLink: err.troubleshootingLink,
    },
  });
}
