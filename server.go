package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"sync"

	"github.com/creack/pty"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/urfave/cli/v2"
)

var terminals sync.Map
var logs sync.Map

func main() {
	app := cli.NewApp()
	app.Name = "Terminal IDE Server"
	app.Usage = "Serve a terminal over WebSockets"
	app.Flags = []cli.Flag{
		&cli.StringFlag{
			Name:  "host",
			Value: "0.0.0.0",
			Usage: "host to bind to",
		},
		&cli.IntFlag{
			Name:  "port",
			Value: 23000,
			Usage: "port to bind to",
		},
	}

	app.Action = func(c *cli.Context) error {
		host := c.String("host")
		port := c.Int("port")

		router := gin.Default()
		router.Static("/dist", "./dist")
		router.Static("/assets", "./assets")
		router.Static("/src", "./src")
		router.GET("/", func(c *gin.Context) {
			c.File("./index.html")
		})

		router.GET("/version", func(c *gin.Context) {
			c.File("./commit.txt")
		})

		router.POST("/terminals", func(c *gin.Context) {
			colsStr := c.Query("cols")
			rowsStr := c.Query("rows")
			if colsStr == "" || rowsStr == "" {
				c.String(http.StatusBadRequest, "`cols` and `rows` are required")
				return
			}

			cols, err := strconv.Atoi(colsStr)
			if err != nil {
				c.String(http.StatusBadRequest, "`cols` must be parsable as integers")
				return
			}

			rows, err := strconv.Atoi(rowsStr)
			if err != nil {
				c.String(http.StatusBadRequest, "`rows` must be parsable as integers")
				return
			}

			env := os.Environ()
			env = append(env, "COLORTERM=truecolor")
			cmd := exec.Command("bash")
			cmd.Env = env

			term, err := pty.Start(cmd)
			if err != nil {
				log.Printf("Error creating terminal: %v", err)
				c.String(http.StatusInternalServerError, "Error creating terminal")
				return
			}

			pid := cmd.Process.Pid
			log.Printf("Created terminal with PID: %d", pid)
			terminals.Store(pid, term)

			var logData string
			logs.Store(pid, &logData)
			go func() {
				buf := make([]byte, 1024)
				for {
					n, err := term.Read(buf)
					if err != nil {
						log.Printf("Error reading from terminal: %v", err)
						terminals.Delete(pid)
						log.Printf("Closed terminal %d", pid)
						return
					}

					logData += string(buf[:n])
				}
			}()

			pty.Setsize(term, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
			c.String(http.StatusCreated, strconv.Itoa(pid))
		})

		router.POST("/terminals/:pid/size", func(c *gin.Context) {
			colsStr := c.Query("cols")
			rowsStr := c.Query("rows")
			if colsStr == "" || rowsStr == "" {
				c.String(http.StatusBadRequest, "`cols` and `rows` are required")
				return
			}

			cols, err := strconv.Atoi(colsStr)
			if err != nil {
				c.String(http.StatusBadRequest, "`cols` must be parsable as integers")
				return
			}

			rows, err := strconv.Atoi(rowsStr)
			if err != nil {
				c.String(http.StatusBadRequest, "`rows` must be parsable as integers")
				return
			}

			pid, err := strconv.Atoi(c.Param("pid"))
			if err != nil {
				c.String(http.StatusBadRequest, "`pid` must be parsable as integer")
				return
			}

			termValue, ok := terminals.Load(pid)
			if !ok {
				c.String(http.StatusNotFound, "Terminal not found")
				return
			}

			term := termValue.(*os.File)
			pty.Setsize(term, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
			log.Printf("Resized terminal %d to %d cols and %d rows.", pid, cols, rows)
			c.Status(http.StatusNoContent)
		})

		wsupgrader := websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		}

		router.GET("/terminals/:pid", func(c *gin.Context) {
			conn, err := wsupgrader.Upgrade(c.Writer, c.Request, nil)
			if err != nil {
				log.Printf("Failed to set websocket upgrade: %+v", err)
				return
			}
			defer conn.Close()

			pid, err := strconv.Atoi(c.Param("pid"))
			if err != nil {
				log.Printf("Invalid PID: %v", err)
				return
			}

			termValue, ok := terminals.Load(pid)
			if !ok {
				log.Printf("Terminal not found")
				return
			}
			term := termValue.(*os.File)

			logDataValue, _ := logs.Load(pid)
			logData := logDataValue.(*string)
			conn.WriteMessage(websocket.TextMessage, []byte(*logData))

			buf := make([]byte, 1024)
			for {
				n, err := term.Read(buf)
				if err != nil {
					log.Printf("Error reading from terminal: %v", err)
					break
				}

				err = conn.WriteMessage(websocket.BinaryMessage, buf[:n])
				if err != nil {
					log.Printf("Error writing to websocket: %v", err)
					break
				}
			}
		})

		log.Printf("App listening on http://%s:%d", host, port)
		router.Run(fmt.Sprintf("%s:%d", host, port))
		return nil
	}

	err := app.Run(os.Args)
	if err != nil {
		log.Fatal(err)
	}
}
