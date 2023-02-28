var items = [
  ["auto", "auto"],
  ["zh-Hans", "zh"],
  ["zh-Hant", "zh"],
  ["en", "en"],
  ["ja", "ja"],
];

var langMap = new Map(items);
var langMapReverse = new Map(items.map(([standardLang, lang]) => [lang, standardLang]));

function supportLanguages() {
  return items.map(([standardLang, lang]) => standardLang);
}

function translate(query, completion) {
  const header = {
    "Content-Type": "application/json",
    "User-Agent": "MOJiDict/20221111 CFNetwork/1399 Darwin/22.1.0",
    "X-Parse-Application-Id": "E62VyFVLMiW7kvbtVq3p",
  };
  (async () => {
    $log.info(`搜索请求 query.text: ${query.text}`);
    const search_resp = await $http.request({
      method: "POST",
      url: "https://api.mojidict.com/parse/functions/search-all",
      header,
      timeout: 10,
      body: {
        "types": ["102", "103", "106", "431"],
        "text": query.text,
        "g_os": "iOS"
      },
    });

    if (search_resp.error) {
      completion({
        error: {
          type: "api",
          message: `API 搜索接口响应错误 - ${search_resp.error.localizedDescription}`,
          addtion: search_resp.error.localizedFailureReason,
        },
      });
    } else {
      $log.info(`搜索请求结果 search_data: ${JSON.stringify(search_resp.data)}`);
      const search_data = search_resp.data.result.result.word.searchResult;
      if (search_data.length === 0) {
        completion({
          error: {
            type: "notFound",
            message: "未找到结果",
          },
        });
        return;
      } 
      const target_id = search_data[0].targetId
      const world_resp = await $http.request({
        method: "POST",
        url: "https://api.mojidict.com/parse/functions/ui-union-apis-word",
        header,
        timeout: 10,
        body: {
          "skipAccessories": false,
          "objectId": target_id,
          "g_os": "iOS",
          "isVerb3": true
        },
      });
      if (world_resp.error) {
        completion({
          error: {
            type: "api",
            message: `API 单词详情接口响应错误 - ${search_resp.error.localizedDescription}`,
            addtion: search_resp.error.localizedFailureReason,
          },
        });
        return;
      }
      const _world_data = world_resp.data.result;
      const world_data = _world_data.result[0];
      const to_dict = {};
      to_dict["word"] = `${world_data.word.spell} ${world_data.word.accent || ""}`;
      to_dict["parts"] = [];
      if (world_data.word.pron) {
        to_dict["parts"].push({
            "part": "平假名",
            "means": [`[${world_data.word.pron}]`]
        });
      }
      if (world_data.word.romaji) {
        to_dict["parts"].push({
            "part": "罗马音",
            "means": [`[${world_data.word.romaji}]`]
        });
      }
      to_dict["exchanges"] = [];
      if (_world_data.thesaurus) {
        if (_world_data.thesaurus.synonyms && _world_data.thesaurus.synonyms.length !== 0) {
            to_dict["exchanges"].push({
                "name": "同义词",
                "words": _world_data.thesaurus.synonyms
            });
        }
        if (_world_data.thesaurus.antonyms && _world_data.thesaurus.antonyms.length !== 0) {
            to_dict["exchanges"].push({
                "name": "反义词",
                "words": _world_data.thesaurus.antonyms
            });
        }
      }
      to_dict["exchanges"].push({
        "name": "原形",
        "words": [_world_data.conjugate.type]
      });
      for (const _form of _world_data.conjugate.forms) {
        for (const form of _form) {
            to_dict["exchanges"].push({
                "name": form.name,
                "words": [form.form]
            });
        }
      }
      to_dict["additions"] = [];
      var num = 1;
      for (const detail of world_data.details) {
        for (const subdetail of world_data.subdetails) {
            if (detail.objectId === subdetail.detailsId) {
                to_dict["additions"].push({
                    "name": ``,
                    "value": `${num}、[${detail.title.replace(/#/g, "·")}] ${subdetail.title}`
                });
                num += 1;
                for (const example of world_data.examples) {
                    if (example.subdetailsId === subdetail.objectId) {
                        to_dict["additions"].push({
                            "name": example.title,
                            "value": example.trans || ""
                        });
                    }
                }
            }
        }
      }
      if (world_data.word.tags) {
        const tags = world_data.word.tags.split("#");
        to_dict["additions"].push({
            "name": "标签",
            "value": tags.join(" / ")
        });
      }
      const to_tts = {};
      const tts_resp = await $http.request({
        method: "POST",
        url: "https://api.mojidict.com/parse/functions/tts-fetch",
        header,
        timeout: 10,
        body: {
          "voiceId": "f000",
          "g_os": "iOS",
          "tarId": target_id,
          "tarType": 102
        },
      });
      if (!world_resp.error) {
        const tts_data = tts_resp.data.result;
        if (tts_data.code === 200) {
          to_tts["type"] = "url";
          to_tts["value"] = tts_data.result.url;
        }
      }
      $log.info(`单词详情请求结果 to_dict: ${JSON.stringify(to_dict)}`);
      completion({
        result: {
          from: query.detectFrom,
          to: query.detectTo,
          toParagraphs: [world_data.word.excerpt.replace(/#/g, "·")],
          toDict: to_dict,
          toTTS: to_tts,
        },
      });
    }
  })().catch((err) => {
    completion({
      error: {
        type: err._type || "unknown",
        message: err._message || "未知错误",
        addtion: err._addtion,
      },
    });
  });
}