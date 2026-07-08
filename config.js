/* ===== よみもち せってい =====
   ここに じぶんの ID と URL を いれてください。
   （アプリ本体の コードは さわらなくて OK） */
window.YOMI_CONFIG = {
  appName: 'よみもち',

  // デプロイ後の こうかいURL（SNSシェアや リンクプレビューに つかう）
  // 例: 'https://yourname.github.io/yomimochi/'
  appUrl: 'https://omochifuufu-lgtm.github.io/yomimochi/',

  // Google Books APIキー（タイトルけんさくを あんていさせる）。
  // リファラ制限ずみ: このサイト以外からは つかえないので 公開してOK。
  googleBooksKey: 'AIzaSyDtoXRNY3kqLuWoETDe1oues__y5JV_WUg',

  // Amazon アソシエイト
  amazon: {
    enabled: true,
    // アソシエイトの トラッキングID（例: 'yomimochi-22'）。
    // 空のままでも 購入リンクは出ますが、収益は つきません。
    tag: 'omochi-twitter-22',
    domain: 'www.amazon.co.jp'
  }
};
