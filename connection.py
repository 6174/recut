import time
from openai import OpenAI


API_KEY = "sk-ant-oat01-QgmoH_91VWrOhaWPF8SqdwUSSPssV79MKrTkNSAMkxvuxMIjlubelEsEHUDQc6EbttXZGDB8_pwFgWamWGfp2CziEhldzAA"

BASE_URL = "https://code.newcli.com/codex/v1"

MODEL = "gpt-5.5"

RETRY_INTERVAL = 5  # 秒


client = OpenAI(
    api_key=API_KEY,
    base_url=BASE_URL,
)


def check_api():
    try:
        response = client.responses.create(
            model=MODEL,
            input="ping",
            max_output_tokens=10,
        )

        # 能返回 response 就认为成功
        if response:
            return True

    except Exception as e:
        print(
            f"[FAIL] {time.strftime('%H:%M:%S')} "
            f"{type(e).__name__}: {e}"
        )

    return False


def main():

    count = 0

    while True:
        count += 1

        print(f"Testing #{count} ...")

        if check_api():
            print("\n================")
            print("OK")
            print("================")
            break

        time.sleep(RETRY_INTERVAL)


if __name__ == "__main__":
    main()