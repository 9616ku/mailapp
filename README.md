# mailapp

WSLで開発するiPhone用のIMAP/SMTPメールアプリ（Expo / React Native）。

## 機能（v1）
- IMAPでフォルダ一覧・メール一覧（無限スクロール）・本文表示（HTMLは画像ブロック付きで表示）
- 件名・差出人・宛先でサーバー検索（失敗時はローカルキャッシュで検索）
- SMTPで新規作成・返信・全員に返信・転送（送信済みフォルダへ保存）
- 認証情報はKeychain（expo-secure-store）、一覧・本文はSQLiteにキャッシュ
- Gmail / iCloud / Yahoo!メールはサーバー設定を自動入力

## 構成
```
index.ts               エントリー（TextDecoderのポリフィルを最初に読み込む）
src/app/               画面（expo-router）
src/mail/transport.ts  react-native-tcp-socket のラッパー（TLS / STARTTLS）
src/mail/imap/         IMAPクライアントと応答パーサ
src/mail/smtp/         SMTPクライアント
src/mail/mime/         メールの組み立て・解析（postal-mime）
src/mail/service.ts    接続管理・キャッシュ連携
src/db/cache.ts        SQLiteキャッシュ
```

## 開発コマンド（WSL）
```bash
npm test             # 単体テスト（IMAP/SMTPは偽サーバー相手）
npm run typecheck
npx expo lint
```

## iPhone実機で動かす
IMAP/SMTPはネイティブのTCPソケットを使うため **Expo Goでは動きません**。開発ビルドが必要です。

1. Apple Developer Program（年額 $99）に登録する
2. Expoアカウントを作ってログインする
   ```bash
   npx eas-cli@latest login
   npx eas-cli@latest init
   ```
3. iPhoneを登録する（表示されたQRコードをiPhoneで開き、プロファイルをインストールする）
   ```bash
   npx eas-cli@latest device:create
   ```
4. 開発ビルドを作る（クラウド上のMacでビルドされ、15〜20分ほどかかる）
   ```bash
   npx eas-cli@latest build --profile development --platform ios
   ```
   完了したら、表示されたQRコードからiPhoneにインストールする。iPhoneの「設定 > プライバシーとセキュリティ > デベロッパモード」をオンにしておく
5. WSLで開発サーバーを起動し、アプリから接続する
   ```bash
   npx expo start --dev-client --tunnel
   ```
   WSLはLAN内の別の機器から見えにくいので `--tunnel` を付ける。以後はコードを保存するとiPhone上のアプリに即座に反映される

ネイティブライブラリを追加・更新したときだけ、手順4をやり直してください。

## Gmailで使う場合
Googleアカウントで2段階認証を有効にし、「アプリパスワード」を発行して、パスワード欄に入力してください。

## 未対応・今後
- プッシュ通知（新着を見張るサーバーが必要）
- 添付ファイルを開く・送る、下書き保存、メールの削除・移動
- OAuthでのログイン（Outlook.comなど）
