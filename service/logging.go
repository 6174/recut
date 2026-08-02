/*
 * [INPUT]: 依赖标准库日志、HTTP 与文件系统能力
 * [OUTPUT]: 对外提供 service 日志文件初始化与按 HTTP 响应状态分级的请求审计中间件
 * [POS]: service 的可观测性边界；main 负责设置日志目的地，Server 负责记录每个已完成请求
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
package main

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func configureServiceLogging(dataDir string) error {
	logsDir := filepath.Join(dataDir, "logs")
	if err := os.MkdirAll(logsDir, 0o755); err != nil {
		return fmt.Errorf("create service log directory: %w", err)
	}
	path := filepath.Join(logsDir, "service-"+time.Now().UTC().Format("2006-01-02")+".log")
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("open service log file: %w", err)
	}
	log.SetOutput(io.MultiWriter(os.Stderr, file))
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds | log.LUTC)
	return nil
}

func withRequestLogging(next http.Handler, logger *log.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		startedAt := time.Now()
		response := &loggingResponseWriter{ResponseWriter: w, status: http.StatusOK}
		defer func() {
			if recovered := recover(); recovered != nil {
				response.status = http.StatusInternalServerError
				response.err = fmt.Errorf("panic: %v", recovered)
				logRequest(logger, r, response, startedAt)
				panic(recovered)
			}
			logRequest(logger, r, response, startedAt)
		}()
		next.ServeHTTP(response, r)
	})
}

func logRequest(logger *log.Logger, request *http.Request, response *loggingResponseWriter, startedAt time.Time) {
	detail := ""
	if response.status >= http.StatusInternalServerError && response.err != nil {
		detail = fmt.Sprintf(" error=%q", response.err)
	}
	logger.Printf("%s request method=%s path=%q status=%d duration=%s%s", requestLogLevel(response.status), request.Method, request.URL.Path, response.status, time.Since(startedAt).Round(time.Microsecond), detail)
}

func requestLogLevel(status int) string {
	if status >= http.StatusInternalServerError {
		return "ERROR"
	}
	if status >= http.StatusBadRequest {
		return "WARN"
	}
	return "INFO"
}

type loggingResponseWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
	err         error
}

func (w *loggingResponseWriter) recordRequestError(err error) { w.err = err }

func (w *loggingResponseWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.status = status
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *loggingResponseWriter) Write(data []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(data)
}

func (w *loggingResponseWriter) Flush() {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *loggingResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("response writer does not support hijacking")
	}
	return hijacker.Hijack()
}

func (w *loggingResponseWriter) ReadFrom(reader io.Reader) (int64, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	if writer, ok := w.ResponseWriter.(io.ReaderFrom); ok {
		return writer.ReadFrom(reader)
	}
	return io.Copy(w.ResponseWriter, reader)
}

func (w *loggingResponseWriter) Push(target string, options *http.PushOptions) error {
	pusher, ok := w.ResponseWriter.(http.Pusher)
	if !ok {
		return http.ErrNotSupported
	}
	return pusher.Push(target, options)
}

func (w *loggingResponseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
