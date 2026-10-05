/*
 * [INPUT]: 依赖 WaveSpeed 提交错误分类器与标准库 net/url/context/io
 * [OUTPUT]: 验证提交响应丢失型错误（client timeout、连接中断、响应截断）被判为「结果不确定」，
 *          而 provider 明确拒绝（HTTP 状态码、限流、校验失败）不被误判
 * [POS]: media/jobs_wavespeed 提交不确定判定的回归门禁；保证 client timeout 不会把已计费的提交判死
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package media

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"testing"
)

type wavespeedTimeoutError struct{}

func (wavespeedTimeoutError) Error() string   { return "i/o timeout" }
func (wavespeedTimeoutError) Timeout() bool   { return true }
func (wavespeedTimeoutError) Temporary() bool { return true }

func TestWavespeedUncertainSubmissionClassifiesTransportLoss(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{name: "nil", err: nil, want: false},
		{name: "client timeout", err: &url.Error{Op: "Post", URL: "https://api.wavespeed.ai/api/v3/x", Err: wavespeedTimeoutError{}}, want: true},
		{name: "deadline exceeded", err: context.DeadlineExceeded, want: true},
		{name: "truncated response", err: io.ErrUnexpectedEOF, want: true},
		{name: "provider http error", err: fmt.Errorf("provider returned 400 Bad Request: invalid prompt"), want: false},
		{name: "rate limit", err: errors.New("WaveSpeed rate limit reached"), want: false},
	}
	for _, tc := range cases {
		if got := wavespeedUncertainSubmission(tc.err); got != tc.want {
			t.Errorf("%s: wavespeedUncertainSubmission() = %v, want %v", tc.name, got, tc.want)
		}
	}
}
