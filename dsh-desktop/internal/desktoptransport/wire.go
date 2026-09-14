package desktoptransport

import (
	"encoding/binary"
	"fmt"
	"io"
)

const (
	frameMagic    = 0x44534833
	chunkBytes    = 65536
	maxMetadata   = 1024 * 1024
	frameStart    = 1
	frameData     = 2
	frameEnd      = 3
	frameCancel   = 4
	frameCredit   = 5
	frameInit     = 128
	frameShutdown = 129
	frameStopped  = 130
)

type frame struct {
	kind    byte
	id      uint32
	payload []byte
}

func readFrame(reader io.Reader) (frame, error) {
	var header [13]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return frame{}, err
	}
	if binary.BigEndian.Uint32(header[:4]) != frameMagic {
		return frame{}, fmt.Errorf("desktop pipe magic mismatch")
	}
	kind, length := header[4], binary.BigEndian.Uint32(header[9:])
	limit := uint32(maxMetadata)
	if kind == frameData {
		limit = chunkBytes
	}
	if length > limit {
		return frame{}, fmt.Errorf("desktop pipe frame exceeds limit")
	}
	result := frame{kind: kind, id: binary.BigEndian.Uint32(header[5:9]), payload: make([]byte, length)}
	_, err := io.ReadFull(reader, result.payload)
	return result, err
}

func writeFrame(writer io.Writer, kind byte, id uint32, payload []byte) error {
	limit := maxMetadata
	if kind == frameData {
		limit = chunkBytes
	}
	if len(payload) > limit {
		return fmt.Errorf("desktop pipe frame exceeds limit")
	}
	var header [13]byte
	binary.BigEndian.PutUint32(header[:4], frameMagic)
	header[4] = kind
	binary.BigEndian.PutUint32(header[5:9], id)
	binary.BigEndian.PutUint32(header[9:], uint32(len(payload)))
	if err := writeAll(writer, header[:]); err != nil {
		return err
	}
	return writeAll(writer, payload)
}

func writeAll(writer io.Writer, bytes []byte) error {
	for len(bytes) > 0 {
		n, err := writer.Write(bytes)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		bytes = bytes[n:]
	}
	return nil
}
